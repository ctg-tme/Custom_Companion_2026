import { connect } from 'jsxapi';
import {
  compareRoomOsVersions,
  isDeskSeries,
  isProductSupported,
} from './manifest';
import type {
  DeviceCompatibility,
  InstalledMacro,
  InstallManifest,
} from './types';

export type BoardXapi = ReturnType<typeof connect>;

export interface BoardCredentials {
  host: string;
  username: string;
  password: string;
}

export function normalizeBoardHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter the Board address.');
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Enter a valid Board hostname or IP address.');
  }
  if (url.username || url.password || !url.host) throw new Error('Enter a valid Board hostname or IP address.');
  return url.host;
}

export function normalizeSerial(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function connectToBoard(credentials: BoardCredentials, timeoutMs = 20_000): Promise<BoardXapi> {
  return new Promise((resolve, reject) => {
    const xapi = connect(`wss://${credentials.host}`, {
      username: credentials.username,
      password: credentials.password,
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      xapi.removeListener('error', onError);
      if (error) {
        xapi.close();
        reject(error);
      } else {
        // Avoid an unhandled EventEmitter error if the socket drops after readiness.
        xapi.on('error', () => undefined);
        resolve(xapi);
      }
    };
    const onError = () => finish(new Error('Unable to connect to the Board. Verify its certificate is trusted, the address is reachable, and the installer credentials are correct.'));
    const timer = window.setTimeout(
      () => finish(new Error('The Board connection timed out. Trust its certificate in this browser, then try again.')),
      timeoutMs,
    );
    xapi.on('error', onError);
    xapi.on('ready', () => finish());
  });
}

function scalarString(value: unknown): string {
  if (Array.isArray(value) && value.length > 0) return scalarString(value[0]);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.Value === 'string' || typeof candidate.Value === 'number') return String(candidate.Value);
  }
  throw new Error('The Board returned an unexpected status value.');
}

export async function validateConnectedBoard(
  xapi: BoardXapi,
  manifest: InstallManifest,
  expectedSerial: string,
): Promise<DeviceCompatibility> {
  const [actualSerialValue, roomOsValue, productValue, activeCallsValue] = await Promise.all([
    xapi.status.get('SystemUnit Hardware Module SerialNumber'),
    xapi.status.get('SystemUnit Software Version'),
    xapi.status.get('SystemUnit ProductPlatform'),
    xapi.status.get('SystemUnit State NumberOfActiveCalls'),
  ]);
  const roomOsVersion = scalarString(roomOsValue);
  const productPlatform = scalarString(productValue);
  const activeCalls = Number(scalarString(activeCallsValue));
  return {
    roomOsVersion,
    productPlatform,
    serialMatches: normalizeSerial(scalarString(actualSerialValue)) === normalizeSerial(expectedSerial),
    roomOsSupported: compareRoomOsVersions(roomOsVersion, manifest.MinimumRoomOSVersion) >= 0,
    productSupported: isProductSupported(productPlatform, manifest.ProductPlatform),
    deskSeriesWarning: isDeskSeries(productPlatform),
    activeCalls: Number.isFinite(activeCalls) ? activeCalls : 0,
  };
}

export async function validateCallbackCredentials(credentials: BoardCredentials): Promise<void> {
  const validationConnection = await connectToBoard(credentials);
  validationConnection.close();
}

function macroArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.Macro)) return record.Macro;
  if (record.Macro) return [record.Macro];
  return [];
}

export async function listInstalledMacros(xapi: BoardXapi): Promise<InstalledMacro[]> {
  const response = await xapi.command('Macros Macro Get', { Content: 'False' });
  return macroArray(response)
    .map((item): InstalledMacro | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Record<string, unknown>;
      const name = record.Name ?? record.name;
      const active = record.Active ?? record.active;
      if (typeof name !== 'string') return undefined;
      return { name, active: String(active).toLowerCase() === 'true' };
    })
    .filter((item): item is InstalledMacro => Boolean(item));
}
