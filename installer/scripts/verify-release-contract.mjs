import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const projectMacroFilePattern = /^Custom-Campanion_[A-Za-z0-9_-]+_2026\.js$/;
const fourPartVersionPattern = /^\d+(?:\.\d+){3}$/;
const installerVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const installerCapabilityPattern = /^installer\.[a-z0-9]+(?:-[a-z0-9]+)*\.v[1-9]\d*$/;

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function headerVersion(source, fileName) {
  const version = source.match(/^\s*\*\s*Version:\s*([^\s*]+)/m)?.[1];
  if (!version) throw new Error(`${fileName} does not contain a Version header.`);
  return version;
}

function configVersion(source, fileName) {
  const version = source.match(/\bversion\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (!version) throw new Error(`${fileName} does not contain config.version.`);
  return version;
}

function relativeImports(source) {
  const imports = [];
  const pattern = /^\s*(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]\.\/([^'"]+)['"];?/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) imports.push(match[1]);
  return imports;
}

function verifySyntax(repositoryDirectory, fileName) {
  const result = spawnSync(process.execPath, ['--check', join(repositoryDirectory, fileName)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'unknown syntax error').trim();
    throw new Error(`${fileName} failed JavaScript syntax validation: ${detail}`);
  }
}

function verifyUserInterfaceMessageFields(source, fileName) {
  const program = parse(source, {
    ecmaVersion: 'latest',
    locations: true,
    sourceType: 'module',
  });
  const violations = [];

  walkSyntaxTree(program, (node) => {
    if (node.type !== 'ObjectExpression') return;
    const properties = new Map();
    for (const property of node.properties) {
      if (property.type !== 'Property') continue;
      const propertyName = syntaxPropertyName(property.key);
      if (propertyName) properties.set(propertyName, property);
    }

    for (const [titleField, textField] of [['Title', 'Text'], ['title', 'text']]) {
      if (!properties.has(titleField) || !properties.has(textField)) continue;
      for (const field of [titleField, textField]) {
        const newlineNode = findStaticNewline(properties.get(field).value);
        if (newlineNode) {
          violations.push(`${field} at line ${newlineNode.loc.start.line}`);
        }
      }
    }
  });

  if (violations.length) {
    throw new Error(`${fileName} UserInterface Message Title and Text fields cannot contain newline characters (${violations.join(', ')}).`);
  }
}

function syntaxPropertyName(key) {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

function findStaticNewline(node) {
  if (node.type === 'Literal' && typeof node.value === 'string' && /[\r\n]/.test(node.value)) {
    return node;
  }
  if (node.type === 'TemplateLiteral') {
    const quasi = node.quasis.find((item) => /[\r\n]/.test(item.value.cooked || ''));
    if (quasi) return quasi;
  }
  for (const child of syntaxChildren(node)) {
    const match = findStaticNewline(child);
    if (match) return match;
  }
  return null;
}

function walkSyntaxTree(node, visit) {
  visit(node);
  for (const child of syntaxChildren(node)) walkSyntaxTree(child, visit);
}

function syntaxChildren(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') children.push(item);
      }
    } else if (value && typeof value.type === 'string') {
      children.push(value);
    }
  }
  return children;
}

export async function verifyReleaseContract(repositoryDirectory) {
  const installerDirectory = join(repositoryDirectory, 'installer');
  const manifest = JSON.parse(await readFile(join(repositoryDirectory, 'manifest.json'), 'utf8'));
  const contract = JSON.parse(await readFile(join(installerDirectory, 'release-contract.json'), 'utf8'));
  const installerPackage = JSON.parse(await readFile(join(installerDirectory, 'package.json'), 'utf8'));

  if (!Array.isArray(manifest.Files) || manifest.Files.length === 0) {
    throw new Error('The root manifest must contain a non-empty Files array.');
  }
  if (!Array.isArray(manifest.ExternalDependencies)) {
    throw new Error('The root manifest must contain an ExternalDependencies array.');
  }
  if (!manifest.CompanionInstaller || typeof manifest.CompanionInstaller !== 'object' || Array.isArray(manifest.CompanionInstaller)) {
    throw new Error('The root manifest must contain CompanionInstaller compatibility metadata.');
  }
  const installerContractVersion = contract.CompanionInstallerContractVersion;
  if (!Number.isInteger(installerContractVersion) || installerContractVersion < 1) {
    throw new Error('CompanionInstallerContractVersion must be a positive integer.');
  }
  if (manifest.CompanionInstaller.ContractVersion !== installerContractVersion) {
    throw new Error(`The root manifest Installer Contract Version must be ${installerContractVersion}.`);
  }
  const installerPackageVersion = requireString(installerPackage.version, 'installer package version');
  if (!installerVersionPattern.test(installerPackageVersion)) {
    throw new Error(`Installer package version ${installerPackageVersion} must be semantic.`);
  }
  if (manifest.CompanionInstaller.TestedVersion !== installerPackageVersion) {
    throw new Error(`The root manifest Tested Installer Version must match installer package version ${installerPackageVersion}.`);
  }
  const manifestCapabilities = manifest.CompanionInstaller.Capabilities;
  if (
    !Array.isArray(manifestCapabilities)
    || manifestCapabilities.some((capability) => typeof capability !== 'string' || !installerCapabilityPattern.test(capability))
  ) {
    throw new Error('The root manifest CompanionInstaller.Capabilities must contain versioned installer capability identifiers.');
  }
  if (new Set(manifestCapabilities).size !== manifestCapabilities.length) {
    throw new Error('The root manifest CompanionInstaller.Capabilities contains duplicate entries.');
  }
  const sortedManifestCapabilities = [...manifestCapabilities].sort();
  if (manifestCapabilities.some((capability, index) => capability !== sortedManifestCapabilities[index])) {
    throw new Error('The root manifest CompanionInstaller.Capabilities must be sorted.');
  }
  const capabilityContracts = contract.InstallerCapabilityContracts;
  if (!capabilityContracts || typeof capabilityContracts !== 'object' || Array.isArray(capabilityContracts)) {
    throw new Error('InstallerCapabilityContracts must be an object.');
  }
  const contractCapabilities = Object.keys(capabilityContracts);
  const sortedContractCapabilities = [...contractCapabilities].sort();
  if (contractCapabilities.some((capability, index) => capability !== sortedContractCapabilities[index])) {
    throw new Error('InstallerCapabilityContracts keys must be sorted.');
  }
  if (
    manifestCapabilities.length !== contractCapabilities.length
    || manifestCapabilities.some((capability, index) => capability !== contractCapabilities[index])
  ) {
    throw new Error('The root manifest Installer Capabilities must exactly match InstallerCapabilityContracts.');
  }
  const capabilityDependencies = contract.InstallerCapabilityDependencies;
  if (!capabilityDependencies || typeof capabilityDependencies !== 'object' || Array.isArray(capabilityDependencies)) {
    throw new Error('InstallerCapabilityDependencies must be an object.');
  }
  for (const [capability, dependencies] of Object.entries(capabilityDependencies)) {
    if (!contractCapabilities.includes(capability)) {
      throw new Error(`InstallerCapabilityDependencies contains an unknown capability: ${capability}.`);
    }
    if (!Array.isArray(dependencies)) {
      throw new Error(`InstallerCapabilityDependencies.${capability} must be an array.`);
    }
    const missing = dependencies.filter((dependency) => !manifestCapabilities.includes(dependency));
    if (missing.length) {
      throw new Error(`${capability} requires Installer Capabilities: ${missing.join(', ')}.`);
    }
  }

  for (const file of manifest.Files) {
    if (typeof file !== 'string' || !projectMacroFilePattern.test(file) || file.includes('/') || file.includes('\\')) {
      throw new Error(`Unsafe or unsupported manifest file path: ${String(file)}`);
    }
  }

  const duplicateFiles = [...new Set(manifest.Files.filter((file, index, files) => files.indexOf(file) !== index))].sort();
  if (duplicateFiles.length) {
    throw new Error(`The root manifest contains duplicate files: ${duplicateFiles.join(', ')}`);
  }

  const repositoryEntries = await readdir(repositoryDirectory, { withFileTypes: true });
  const discoveredProjectFiles = repositoryEntries
    .filter((entry) => entry.isFile() && projectMacroFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const manifestFileSet = new Set(manifest.Files);
  const discoveredFileSet = new Set(discoveredProjectFiles);
  const missingFromManifest = discoveredProjectFiles.filter((file) => !manifestFileSet.has(file));
  const missingFromRepository = manifest.Files.filter((file) => !discoveredFileSet.has(file)).sort();

  if (missingFromManifest.length || missingFromRepository.length) {
    const details = [
      missingFromManifest.length ? `missing from manifest: ${missingFromManifest.join(', ')}` : '',
      missingFromRepository.length ? `listed but missing from repository: ${missingFromRepository.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`The root manifest does not match the deployable root macros (${details.join('; ')}).`);
  }

  const mainMacroFile = requireString(contract.MainMacroFile, 'MainMacroFile');
  const configMacroFile = requireString(contract.ConfigMacroFile, 'ConfigMacroFile');
  const roomReferenceMacroFile = requireString(contract.RoomReferenceMacroFile, 'RoomReferenceMacroFile');
  requireString(contract.GeneratedStorageMacro, 'GeneratedStorageMacro');
  const requiredAnchorFiles = [mainMacroFile, configMacroFile, roomReferenceMacroFile];
  const missingAnchors = requiredAnchorFiles.filter((file) => !manifestFileSet.has(file));
  if (missingAnchors.length) {
    throw new Error(`The Release Contract anchors are missing from the manifest: ${missingAnchors.join(', ')}`);
  }

  const sourceByFile = new Map();
  for (const file of manifest.Files) {
    const source = await readFile(join(repositoryDirectory, file), 'utf8');
    sourceByFile.set(file, source);
    verifySyntax(repositoryDirectory, file);
    verifyUserInterfaceMessageFields(source, file);
  }

  const mainSource = sourceByFile.get(mainMacroFile);
  const configSource = sourceByFile.get(configMacroFile);
  const roomReferenceSource = sourceByFile.get(roomReferenceMacroFile);
  const versionLocations = {
    [`${mainMacroFile} header`]: headerVersion(mainSource, mainMacroFile),
    [`${configMacroFile} header`]: headerVersion(configSource, configMacroFile),
    [`${configMacroFile} config.version`]: configVersion(configSource, configMacroFile),
    [`${roomReferenceMacroFile} header`]: headerVersion(roomReferenceSource, roomReferenceMacroFile),
  };
  const distinctVersions = [...new Set(Object.values(versionLocations))];
  if (distinctVersions.length !== 1) {
    const details = Object.entries(versionLocations).map(([location, version]) => `${location}=${version}`).join(', ');
    throw new Error(`Runtime project versions are not synchronized (${details}).`);
  }
  const projectVersion = distinctVersions[0];
  if (!fourPartVersionPattern.test(projectVersion)) {
    throw new Error(`Runtime project version ${projectVersion} must contain four numeric components.`);
  }

  const availableMacroNames = new Set(manifest.Files.map((file) => file.replace(/\.js$/, '')));
  for (const dependency of manifest.ExternalDependencies) {
    if (!dependency || typeof dependency !== 'object') {
      throw new Error('Every ExternalDependencies entry must be an object.');
    }
    availableMacroNames.add(requireString(dependency.Name, 'ExternalDependencies.Name'));
  }

  for (const [fileName, source] of sourceByFile) {
    const unresolvedImports = relativeImports(source)
      .map((target) => target.replace(/\.js$/, ''))
      .filter((target) => !availableMacroNames.has(target));
    if (unresolvedImports.length) {
      throw new Error(`${fileName} has relative imports absent from the Release Manifest: ${[...new Set(unresolvedImports)].join(', ')}`);
    }
  }

  const initializationSuccessMessage = requireString(contract.InitializationSuccessMessage, 'InitializationSuccessMessage');
  const initializationStoppedMessage = requireString(contract.InitializationStoppedMessage, 'InitializationStoppedMessage');
  for (const message of [initializationSuccessMessage, initializationStoppedMessage]) {
    if (!mainSource.includes(message)) {
      throw new Error(`${mainMacroFile} does not emit the Release Contract message: ${message}`);
    }
  }

  const allProjectSource = [...sourceByFile.values()].join('\n');
  for (const capability of manifestCapabilities) {
    const contractFields = capabilityContracts[capability];
    if (!Array.isArray(contractFields) || contractFields.length === 0) {
      throw new Error(`${capability} must map to one or more Release Contract fields.`);
    }
    for (const field of contractFields) {
      const value = requireString(contract[field], `InstallerCapabilityContracts.${capability}.${String(field)}`);
      if (!allProjectSource.includes(value)) {
        throw new Error(`The deployable source does not contain the ${capability} Release Contract value: ${value}`);
      }
    }
  }

  return {
    contract,
    manifest,
    projectFiles: discoveredProjectFiles,
    projectVersion,
  };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const repositoryDirectory = resolve(dirname(currentFile), '..', '..');
  try {
    const result = await verifyReleaseContract(repositoryDirectory);
    console.log(`Verified Release Contract ${result.projectVersion} across ${result.projectFiles.length} project macros.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
