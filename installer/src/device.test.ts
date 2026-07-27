import { describe, expect, it, vi } from 'vitest';
import type { InstallManifest } from './types';
import { validateConnectedCompanionDevice } from './device';

const manifest: InstallManifest = {
  SchemaVersion: 1,
  MinimumRoomOSVersion: '11.32.1.1',
  SoftwarePlatform: ['RoomOS'],
  ProductPlatform: ['Board Pro'],
  CompanionInstaller: {
    ContractVersion: 1,
    TestedVersion: '0.1.21',
    Capabilities: [],
  },
  Files: [],
  ExternalDependencies: [],
};

function createXapi(mode: 'On' | 'Off', allowInsecureHTTPS: 'True' | 'False') {
  const configSet = vi.fn(async () => undefined);
  const command = vi.fn(async () => undefined);
  return {
    xapi: {
      status: {
        get: vi.fn(async (path: string) => {
          if (path === 'SystemUnit Hardware Module SerialNumber') return 'COMPANION123';
          if (path === 'SystemUnit Software Version') return '11.32.1.1';
          if (path === 'SystemUnit ProductPlatform') return 'Board Pro';
          if (path === 'SystemUnit State NumberOfActiveCalls') return '0';
          throw new Error(`Unexpected status path ${path}`);
        }),
      },
      config: {
        get: vi.fn(async (path: string) => {
          if (path === 'HttpClient Mode') return mode;
          if (path === 'HttpClient AllowInsecureHTTPS') return allowInsecureHTTPS;
          throw new Error(`Unexpected config path ${path}`);
        }),
        set: configSet,
      },
      command,
    },
    configSet,
    command,
  };
}

describe('Companion Device HTTPClient preflight', () => {
  it.each([
    ['False', 'Strict certificate validation'],
    ['True', 'Untrusted/self-signed certificates permitted'],
  ] as const)('reports the administrator-owned posture when Mode=On and AllowInsecureHTTPS=%s', async (
    allowInsecureHTTPS,
    trustPosture,
  ) => {
    const harness = createXapi('On', allowInsecureHTTPS);

    await expect(validateConnectedCompanionDevice(
      harness.xapi as never,
      manifest,
      'COMPANION123',
    )).resolves.toMatchObject({
      httpClientMode: 'On',
      httpClientAllowsInsecureHTTPS: allowInsecureHTTPS === 'True',
      httpClientTrustPosture: trustPosture,
    });
    expect(harness.configSet).not.toHaveBeenCalled();
    expect(harness.command).not.toHaveBeenCalled();
  });

  it('blocks Mode=Off with the exact administrator action before any mutation', async () => {
    const harness = createXapi('Off', 'False');

    await expect(validateConnectedCompanionDevice(
      harness.xapi as never,
      manifest,
      'COMPANION123',
    )).rejects.toThrow('Set xConfiguration HttpClient Mode to On, then reconnect.');
    expect(harness.configSet).not.toHaveBeenCalled();
    expect(harness.command).not.toHaveBeenCalled();
  });
});
