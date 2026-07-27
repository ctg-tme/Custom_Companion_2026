import { describe, expect, it, vi } from 'vitest';
import type { InstallManifest } from './types';
import {
  monitorHttpClientTrustPosture,
  validateConnectedCompanionDevice,
} from './device';

const manifest: InstallManifest = {
  SchemaVersion: 1,
  MinimumRoomOSVersion: '11.32.1.1',
  SoftwarePlatform: ['RoomOS'],
  ProductPlatform: ['Board Pro'],
  CompanionInstaller: {
    ContractVersion: 1,
    TestedVersion: '0.1.25',
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

  it('subscribes to AllowInsecureHTTPS, refreshes the current value, and reports later changes', async () => {
    let listener: ((value: unknown) => void) | undefined;
    const unsubscribe = Object.assign(vi.fn(), {
      registration: Promise.resolve({ Id: 17 }),
    });
    const configGet = vi.fn(async () => 'False');
    const configOn = vi.fn((_path: string, callback: (value: unknown) => void) => {
      listener = callback;
      return unsubscribe;
    });
    const onChange = vi.fn();

    const closeMonitor = await monitorHttpClientTrustPosture({
      config: {
        get: configGet,
        on: configOn,
      },
    } as never, onChange);

    expect(configOn).toHaveBeenCalledWith('HttpClient AllowInsecureHTTPS', expect.any(Function));
    expect(configGet).toHaveBeenCalledWith('HttpClient AllowInsecureHTTPS');
    expect(onChange).toHaveBeenLastCalledWith({
      httpClientAllowsInsecureHTTPS: false,
      httpClientTrustPosture: 'Strict certificate validation',
    });

    listener?.({ Value: 'True' });
    expect(onChange).toHaveBeenLastCalledWith({
      httpClientAllowsInsecureHTTPS: true,
      httpClientTrustPosture: 'Untrusted/self-signed certificates permitted',
    });

    closeMonitor();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
