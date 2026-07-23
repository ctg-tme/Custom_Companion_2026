import releaseContract from '../release-contract.json';

export const MAIN_MACRO_FILE = releaseContract.MainMacroFile;
export const CONFIG_MACRO_FILE = releaseContract.ConfigMacroFile;
export const ROOM_REFERENCE_MACRO_FILE = releaseContract.RoomReferenceMacroFile;
export const INITIALIZATION_SUCCESS_MESSAGE = releaseContract.InitializationSuccessMessage;
export const INITIALIZATION_STOPPED_MESSAGE = releaseContract.InitializationStoppedMessage;
export const GENERATED_STORAGE_MACRO = releaseContract.GeneratedStorageMacro;
export const PROJECT_MACRO_PATTERN = /^Custom-Campanion_.*_2026$/;

export type InstallationType = 'standard' | 'clean';

export interface ExternalDependency {
  Name: string;
  RawUrl: string;
}

export interface InstallManifest {
  SchemaVersion: 1;
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

export interface DeviceCompatibility {
  roomOsVersion: string;
  productPlatform: string;
  serialMatches: boolean;
  roomOsSupported: boolean;
  productSupported: boolean;
  deskSeriesWarning: boolean;
  activeCalls: number;
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
