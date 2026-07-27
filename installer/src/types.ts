import releaseContract from '../release-contract.json';

export const MAIN_MACRO_FILE = releaseContract.MainMacroFile;
export const CONFIG_MACRO_FILE = releaseContract.ConfigMacroFile;
export const ROOM_REFERENCE_MACRO_FILE = releaseContract.RoomReferenceMacroFile;
export const INITIALIZATION_SUCCESS_MESSAGE = releaseContract.InitializationSuccessMessage;
export const INITIALIZATION_STOPPED_MESSAGE = releaseContract.InitializationStoppedMessage;
export const COMPANION_INSTALLER_CONTRACT_VERSION = releaseContract.CompanionInstallerContractVersion;
export const INSTALLER_CAPABILITY_DEPENDENCIES = releaseContract.InstallerCapabilityDependencies;
export const INSTALLER_PARENT_DEREGISTRATION_CAPABILITY = 'installer.parent-deregistration.v1';
export const INSTALLER_PARENT_INVENTORY_CAPABILITY = 'installer.parent-inventory.v1';
export const INSTALLER_PARENT_REGISTRATION_CAPABILITY = 'installer.parent-registration.v1';
export const INSTALLER_PARENT_REGISTRATION_ACTION = releaseContract.InstallerParentRegistrationAction;
export const INSTALLER_PARENT_REGISTRATION_SUCCESS_MESSAGE = releaseContract.InstallerParentRegistrationSuccessMessage;
export const INSTALLER_PARENT_REGISTRATION_FAILURE_MESSAGE = releaseContract.InstallerParentRegistrationFailureMessage;
export const INSTALLER_PARENT_INVENTORY_ACTION = releaseContract.InstallerParentInventoryAction;
export const INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE = releaseContract.InstallerParentInventorySuccessMessage;
export const INSTALLER_PARENT_INVENTORY_FAILURE_MESSAGE = releaseContract.InstallerParentInventoryFailureMessage;
export const INSTALLER_PARENT_DEREGISTRATION_ACTION = releaseContract.InstallerParentDeregistrationAction;
export const INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE = releaseContract.InstallerParentDeregistrationSuccessMessage;
export const INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE = releaseContract.InstallerParentDeregistrationPendingMessage;
export const INSTALLER_PARENT_DEREGISTRATION_FAILURE_MESSAGE = releaseContract.InstallerParentDeregistrationFailureMessage;
export const GENERATED_STORAGE_MACRO = releaseContract.GeneratedStorageMacro;
export const PROJECT_MACRO_PATTERN = /^Custom-Campanion_.*_2026$/;

export type InstallationType = 'preserve' | 'fresh';

export interface ExternalDependency {
  Name: string;
  RawUrl: string;
}

export interface CompanionInstallerManifest {
  ContractVersion: number;
  TestedVersion: string;
  Capabilities: string[];
}

export interface InstallManifest {
  SchemaVersion: 1;
  CompanionInstaller: CompanionInstallerManifest;
  Files: string[];
  MinimumRoomOSVersion: string;
  SoftwarePlatform: string[];
  ProductPlatform: string[];
  ExternalDependencies: ExternalDependency[];
}

export type ReleaseKind = 'stable' | 'preview' | 'main';

export interface ReleaseSource {
  id: string;
  label: string;
  kind: ReleaseKind;
  resourceUrl: string;
  version?: string;
  tagName?: string;
  publishedAt?: string;
}

export interface ReleaseDiscovery {
  sources: ReleaseSource[];
  defaultSourceId: string;
  unreachableReason?: string;
}

export interface InstallResource {
  macroName: string;
  fileName: string;
  content: string;
  kind: 'project' | 'external';
}

export interface SourceSnapshot {
  source: ReleaseSource;
  commitSha: string;
  manifest: InstallManifest;
  resources: InstallResource[];
}

export interface HttpClientTrustPosture {
  httpClientAllowsInsecureHTTPS: boolean;
  httpClientTrustPosture: 'Strict certificate validation' | 'Untrusted/self-signed certificates permitted';
}

export interface DeviceCompatibility extends HttpClientTrustPosture {
  roomOsVersion: string;
  productPlatform: string;
  serialMatches: boolean;
  roomOsSupported: boolean;
  productSupported: boolean;
  deskSeriesWarning: boolean;
  activeCalls: number;
  httpClientMode: 'On';
}

export interface InstalledMacro {
  name: string;
  active: boolean;
}

export type JsonPrimitive = string | number | boolean | null;
export type ConfigValue = JsonPrimitive | ConfigValue[] | { [key: string]: ConfigValue };

export interface ConfigLeaf {
  path: Array<string | number>;
  value: ConfigValue;
  start: number;
  end: number;
  description?: string;
  lockedReason?: 'version' | 'companion-device-host';
}

export interface ConfigDocument {
  source: string;
  value: { [key: string]: ConfigValue };
  leaves: ConfigLeaf[];
}

export type InitializationOutcomeKind =
  | 'ready'
  | 'ready-with-warnings'
  | 'failed'
  | 'timeout';

export interface InitializationOutcome {
  kind: InitializationOutcomeKind;
  warnings: string[];
  failure?: string;
}

export interface ParentRegistrationForm {
  host: string;
  serial: string;
  username: string;
  password: string;
  passwordConfirmation: string;
  allowOverwrite: boolean;
}

export interface ParentRegistrationRequest {
  transactionId: string;
  text: string;
}

export type ParentRegistrationOutcomeKind = 'succeeded' | 'failed' | 'timeout';

export interface ParentRegistrationOutcome {
  kind: ParentRegistrationOutcomeKind;
  message?: string;
}

export interface ParentAdministrationRequest {
  transactionId: string;
  text: string;
}

export interface RegisteredParentSummary {
  serial: string;
  name: string;
  host: string;
  active: boolean;
}

export interface PendingDeregistrationSummary {
  serial: string;
  name: string;
  host: string;
  createdAt: string;
}

export interface ParentInventory {
  registered: RegisteredParentSummary[];
  pending: PendingDeregistrationSummary[];
}

export type ParentDeregistrationOutcome =
  | { kind: 'completed'; detail: string }
  | { kind: 'pending'; detail: string }
  | { kind: 'failed'; detail: string }
  | { kind: 'timeout'; detail: string };
