import type { ConfigLeaf } from './types';

export interface ConfigGroup {
  path: Array<string | number>;
  label: string;
  leaves: ConfigLeaf[];
  children: ConfigGroup[];
}

export function humanizeConfigSegment(segment: string | number): string {
  if (typeof segment === 'number') return `Item ${segment + 1}`;
  const words = segment
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/);
  const acronyms: Record<string, string> = { url: 'URL', ui: 'UI', http: 'HTTP', pin: 'PIN', id: 'ID' };
  return words.map((word) => acronyms[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

export function groupConfigLeaves(leaves: ConfigLeaf[]): ConfigGroup {
  const root: ConfigGroup = { path: [], label: 'General', leaves: [], children: [] };
  const childMaps = new WeakMap<ConfigGroup, Map<string, ConfigGroup>>();
  childMaps.set(root, new Map());

  for (const leaf of leaves) {
    let group = root;
    for (const segment of leaf.path.slice(0, -1)) {
      const key = `${typeof segment}:${String(segment)}`;
      const children = childMaps.get(group) ?? new Map<string, ConfigGroup>();
      childMaps.set(group, children);
      let child = children.get(key);
      if (!child) {
        child = {
          path: [...group.path, segment],
          label: humanizeConfigSegment(segment),
          leaves: [],
          children: [],
        };
        children.set(key, child);
        group.children.push(child);
        childMaps.set(child, new Map());
      }
      group = child;
    }
    group.leaves.push(leaf);
  }

  return root;
}
