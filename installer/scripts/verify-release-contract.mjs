import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectMacroFilePattern = /^Custom-Campanion_[A-Za-z0-9_-]+_2026\.js$/;
const fourPartVersionPattern = /^\d+(?:\.\d+){3}$/;

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

export async function verifyReleaseContract(repositoryDirectory) {
  const installerDirectory = join(repositoryDirectory, 'installer');
  const manifest = JSON.parse(await readFile(join(repositoryDirectory, 'manifest.json'), 'utf8'));
  const contract = JSON.parse(await readFile(join(installerDirectory, 'release-contract.json'), 'utf8'));

  if (!Array.isArray(manifest.Files) || manifest.Files.length === 0) {
    throw new Error('The root manifest must contain a non-empty Files array.');
  }
  if (!Array.isArray(manifest.ExternalDependencies)) {
    throw new Error('The root manifest must contain an ExternalDependencies array.');
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
