import {
  COMPANION_INSTALLER_CONTRACT_VERSION,
  CONFIG_MACRO_FILE,
  INSTALLER_CAPABILITY_DEPENDENCIES,
  INSTALLER_PARENT_DEREGISTRATION_CAPABILITY,
  INSTALLER_PARENT_INVENTORY_CAPABILITY,
  INSTALLER_PARENT_REGISTRATION_CAPABILITY,
  MAIN_MACRO_FILE,
  type InstallManifest,
} from './types';

const VERSION_PATTERN = /^\d+(?:\.\d+){3}$/;
const INSTALLER_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INSTALLER_CAPABILITY_PATTERN = /^installer\.[a-z0-9]+(?:-[a-z0-9]+)*\.v[1-9]\d*$/;
const FILE_PATTERN = /^Custom-Campanion_[A-Za-z0-9_-]+_2026\.js$/;
const MACRO_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error(`${field} must be a non-empty array of strings.`);
  }
  return value;
}

function requireInstallerCapabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !INSTALLER_CAPABILITY_PATTERN.test(item))) {
    throw new Error('CompanionInstaller.Capabilities must be an array of versioned installer capability identifiers.');
  }
  if (new Set(value).size !== value.length) {
    throw new Error('CompanionInstaller.Capabilities contains a duplicate entry.');
  }
  const sorted = [...value].sort();
  if (value.some((item, index) => item !== sorted[index])) {
    throw new Error('CompanionInstaller.Capabilities must be sorted.');
  }
  return value;
}

export function validateManifest(value: unknown): InstallManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The release manifest must be a JSON object.');
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.SchemaVersion !== 1) {
    throw new Error('Only manifest SchemaVersion 1 is supported.');
  }

  if (!candidate.CompanionInstaller || typeof candidate.CompanionInstaller !== 'object' || Array.isArray(candidate.CompanionInstaller)) {
    throw new Error('CompanionInstaller compatibility metadata is required.');
  }
  const companionInstaller = candidate.CompanionInstaller as Record<string, unknown>;
  if (companionInstaller.ContractVersion !== COMPANION_INSTALLER_CONTRACT_VERSION) {
    throw new Error(`Installer Contract Version ${String(companionInstaller.ContractVersion)} is not supported by this installer.`);
  }
  if (typeof companionInstaller.TestedVersion !== 'string' || !INSTALLER_VERSION_PATTERN.test(companionInstaller.TestedVersion)) {
    throw new Error('CompanionInstaller.TestedVersion must be a semantic installer version.');
  }
  const installerCapabilities = requireInstallerCapabilities(companionInstaller.Capabilities);
  for (const [capability, dependencies] of Object.entries(INSTALLER_CAPABILITY_DEPENDENCIES)) {
    if (!installerCapabilities.includes(capability)) continue;
    const missing = dependencies.filter((dependency) => !installerCapabilities.includes(dependency));
    if (missing.length) {
      throw new Error(`${capability} requires Installer Capabilities: ${missing.join(', ')}.`);
    }
  }

  const files = requireStringArray(candidate.Files, 'Files');
  if (new Set(files).size !== files.length) {
    throw new Error('Files contains a duplicate entry.');
  }
  if (files.some((file) => !FILE_PATTERN.test(file) || file.includes('/') || file.includes('\\'))) {
    throw new Error('Files contains an unsupported or unsafe macro filename.');
  }
  if (!files.includes(MAIN_MACRO_FILE) || !files.includes(CONFIG_MACRO_FILE)) {
    throw new Error(`Files must contain ${MAIN_MACRO_FILE} and ${CONFIG_MACRO_FILE}.`);
  }

  if (typeof candidate.MinimumRoomOSVersion !== 'string' || !VERSION_PATTERN.test(candidate.MinimumRoomOSVersion)) {
    throw new Error('MinimumRoomOSVersion must contain four numeric components.');
  }

  const softwarePlatforms = requireStringArray(candidate.SoftwarePlatform, 'SoftwarePlatform');
  const productPlatforms = requireStringArray(candidate.ProductPlatform, 'ProductPlatform');
  if (!Array.isArray(candidate.ExternalDependencies)) {
    throw new Error('ExternalDependencies must be an array.');
  }

  const externalDependencies = candidate.ExternalDependencies.map((dependency, index) => {
    if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
      throw new Error(`ExternalDependencies[${index}] must be an object.`);
    }
    const item = dependency as Record<string, unknown>;
    if (typeof item.Name !== 'string' || !MACRO_NAME_PATTERN.test(item.Name)) {
      throw new Error(`ExternalDependencies[${index}].Name is not a valid macro name.`);
    }
    if (typeof item.RawUrl !== 'string') {
      throw new Error(`ExternalDependencies[${index}].RawUrl must be a URL.`);
    }
    let url: URL;
    try {
      url = new URL(item.RawUrl);
    } catch {
      throw new Error(`ExternalDependencies[${index}].RawUrl must be a valid URL.`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`ExternalDependencies[${index}].RawUrl must use HTTPS.`);
    }
    return { Name: item.Name, RawUrl: item.RawUrl };
  });

  return {
    SchemaVersion: 1,
    CompanionInstaller: {
      ContractVersion: COMPANION_INSTALLER_CONTRACT_VERSION,
      TestedVersion: companionInstaller.TestedVersion,
      Capabilities: installerCapabilities,
    },
    Files: files,
    MinimumRoomOSVersion: candidate.MinimumRoomOSVersion,
    SoftwarePlatform: softwarePlatforms,
    ProductPlatform: productPlatforms,
    ExternalDependencies: externalDependencies,
  };
}

export function hasInstallerCapability(manifest: InstallManifest | undefined, capability: string): boolean {
  return manifest?.CompanionInstaller.Capabilities.includes(capability) ?? false;
}

export function completeSetupCapabilities(manifest: InstallManifest | undefined): {
  parentRegistration: boolean;
  parentInventory: boolean;
  parentDeregistration: boolean;
} {
  return {
    parentRegistration: hasInstallerCapability(manifest, INSTALLER_PARENT_REGISTRATION_CAPABILITY),
    parentInventory: hasInstallerCapability(manifest, INSTALLER_PARENT_INVENTORY_CAPABILITY),
    parentDeregistration: hasInstallerCapability(manifest, INSTALLER_PARENT_DEREGISTRATION_CAPABILITY),
  };
}

export function parseRoomOsVersion(value: string): number[] {
  const match = value.match(/\d+(?:\.\d+){3}/);
  if (!match) {
    throw new Error('The Companion Device returned an unrecognized RoomOS version.');
  }
  return match[0].split('.').map(Number);
}

export function compareRoomOsVersions(left: string, right: string): number {
  const leftParts = parseRoomOsVersion(left);
  const rightParts = parseRoomOsVersion(right);
  for (let index = 0; index < 4; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function normalizeProductPlatform(value: string): string {
  return value
    .toLowerCase()
    .replace(/^cisco/, '')
    .replace(/(boardpro)(55|75)/, '$1')
    .replace(/[^a-z0-9]/g, '');
}

export function isProductSupported(actual: string, allowed: string[]): boolean {
  const normalizedActual = normalizeProductPlatform(actual);
  return allowed.some((value) => normalizeProductPlatform(value) === normalizedActual);
}

export function isDeskSeries(value: string): boolean {
  return normalizeProductPlatform(value).includes('desk');
}
