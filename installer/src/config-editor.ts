import { parse } from 'acorn';
import type { ConfigDocument, ConfigLeaf, ConfigValue } from './types';

type SyntaxNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

export function configPathId(path: Array<string | number>): string {
  return path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
}

export function formatConfigPath(path: Array<string | number>): string {
  return path.map(String).join('.');
}

function propertyName(node: SyntaxNode): string {
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if (node.type === 'Literal' && (typeof node.value === 'string' || typeof node.value === 'number')) return String(node.value);
  throw new Error('The config object contains an unsupported computed property.');
}

function lockedReason(path: Array<string | number>): ConfigLeaf['lockedReason'] {
  const last = path.at(-1);
  if (typeof last === 'string' && last.toLowerCase() === 'version') return 'version';
  if (path.length === 2 && path[0] === 'CompanionBoardInformation' && path[1] === 'host') return 'companion-device-host';
  return undefined;
}

function evaluateNode(node: SyntaxNode, path: Array<string | number>, leaves: ConfigLeaf[]): ConfigValue {
  if (node.type === 'Literal') {
    const value = node.value;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Unsupported config value at ${formatConfigPath(path)}.`);
    }
    const leaf: ConfigLeaf = {
      path,
      value: value as ConfigValue,
      start: node.start,
      end: node.end,
    };
    const reason = lockedReason(path);
    if (reason) leaf.lockedReason = reason;
    leaves.push(leaf);
    return leaf.value;
  }

  if (node.type === 'ArrayExpression') {
    const elements = node.elements as Array<SyntaxNode | null>;
    if (elements.length === 0) {
      leaves.push({ path, value: [], start: node.start, end: node.end, lockedReason: lockedReason(path) });
      return [];
    }
    return elements.map((element, index) => {
      if (!element) throw new Error(`Sparse arrays are unsupported at ${formatConfigPath(path)}.`);
      return evaluateNode(element, [...path, index], leaves);
    });
  }

  if (node.type === 'ObjectExpression') {
    const properties = node.properties as SyntaxNode[];
    if (properties.length === 0) {
      leaves.push({ path, value: {}, start: node.start, end: node.end, lockedReason: lockedReason(path) });
      return {};
    }
    const result: Record<string, ConfigValue> = {};
    for (const property of properties) {
      if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method || property.shorthand) {
        throw new Error(`Unsupported config property at ${formatConfigPath(path)}.`);
      }
      const key = propertyName(property.key as SyntaxNode);
      result[key] = evaluateNode(property.value as SyntaxNode, [...path, key], leaves);
    }
    return result;
  }

  throw new Error(`The config contains an unsupported ${node.type} expression at ${formatConfigPath(path)}.`);
}

export function parseConfigDocument(source: string): ConfigDocument {
  const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: SyntaxNode[] };
  let configNode: SyntaxNode | undefined;

  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations as SyntaxNode[]) {
      const identifier = declaration.id as SyntaxNode;
      if (identifier.type === 'Identifier' && identifier.name === 'config') {
        configNode = declaration.init as SyntaxNode;
      }
    }
  }

  if (!configNode || configNode.type !== 'ObjectExpression') {
    throw new Error('The Config macro must declare a literal object named config.');
  }

  const leaves: ConfigLeaf[] = [];
  const value = evaluateNode(configNode, [], leaves);
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('The config value must be an object.');
  }
  return { source, value, leaves } as ConfigDocument;
}

function serializeValue(value: ConfigValue): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
}

export function patchConfigSource(document: ConfigDocument, values: Map<string, ConfigValue>): string {
  const replacements = document.leaves
    .map((leaf) => {
      const id = configPathId(leaf.path);
      const value = values.has(id) ? values.get(id)! : leaf.value;
      const serializedValue = serializeValue(value);
      const serializedOriginal = serializeValue(leaf.value);
      if (leaf.lockedReason === 'version' && serializedValue !== serializedOriginal) {
        throw new Error(`${formatConfigPath(leaf.path)} is controlled by the installer and cannot be edited directly.`);
      }
      if (serializedValue === serializedOriginal) return undefined;
      return { start: leaf.start, end: leaf.end, text: serializedValue };
    })
    .filter((replacement): replacement is { start: number; end: number; text: string } => Boolean(replacement))
    .sort((left, right) => right.start - left.start);

  let result = document.source;
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`;
  }
  return result;
}

export function setLockedInstallerValues(
  document: ConfigDocument,
  values: Map<string, ConfigValue>,
  companionDeviceHost: string,
): Map<string, ConfigValue> {
  const result = new Map(values);
  for (const leaf of document.leaves) {
    if (leaf.lockedReason === 'companion-device-host') result.set(configPathId(leaf.path), companionDeviceHost);
  }
  return result;
}

export function configValueAt(root: ConfigValue, path: Array<string | number>): ConfigValue | undefined {
  let current: ConfigValue | undefined = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Array.isArray(current)
      ? current[Number(part)]
      : current[String(part)];
  }
  return current;
}

export function redactConfig(value: ConfigValue, key = ''): ConfigValue {
  if (/(password|secret|token)/i.test(key)) return '••••••••';
  if (Array.isArray(value)) return value.map((item) => redactConfig(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactConfig(childValue, childKey)]));
  }
  return value;
}
