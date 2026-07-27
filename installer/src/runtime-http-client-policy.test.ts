import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  configPathId,
  formatConfigPath,
  parseConfigDocument,
  patchConfigSource,
} from './config-editor';
import type { ConfigValue } from './types';

type HttpClientPost = (parameters: Record<string, unknown>, body: string) => Promise<Record<string, unknown>>;

type DeviceCommsModule = {
  initializeHttpTransport: (options?: Record<string, unknown>) => Record<string, unknown>;
  validateHttpClientPrerequisites: (xapi: Record<string, unknown>) => Promise<{
    mode: string;
    allowInsecureHTTPS: boolean;
    trustPosture: string;
  }>;
  parentInitializationRequest: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  parentStandbyStateRequest: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
  ) => Promise<string>;
  installParentMacros: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
    macros: Record<string, string>,
    installConfig: Record<string, string>,
  ) => Promise<Record<string, unknown>>;
  sendMessageCommand: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
    action: string,
    payload: Record<string, unknown>,
    messageConfig: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  connectPeripheral: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
    peripheral: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  sendPeripheralHeartbeat: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
    peripheralId: string,
    timeoutSeconds: number,
  ) => Promise<Record<string, unknown>>;
  getCallStatus: (
    xapi: Record<string, unknown>,
    device: Record<string, unknown>,
  ) => Promise<Record<string, unknown>[]>;
};

type RegistrationController = {
  setState: (parents: Record<string, unknown>[], tombstones: Record<string, unknown>[]) => void;
  handleInstallerRegistrationRequest: (message: Record<string, unknown>) => Promise<boolean>;
  handleInstallerDeregistrationRequest: (message: Record<string, unknown>) => Promise<boolean>;
  handleMessage: (message: Record<string, unknown>) => Promise<boolean>;
};

async function loadDeviceComms(): Promise<DeviceCommsModule> {
  const source = await readFile(new URL('../../Custom-Campanion_6_DeviceComms_2026.js', import.meta.url), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${crypto.randomUUID()}`;
  const loaded = await import(moduleUrl) as { deviceComms: DeviceCommsModule };
  return loaded.deviceComms;
}

async function loadParentRegistration() {
  const source = await readFile(new URL('../../Custom-Campanion_15_ParentRegistration_2026.js', import.meta.url), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${crypto.randomUUID()}`;
  return import(moduleUrl) as Promise<{
    parentRegistration: {
      create: (options: Record<string, unknown>) => RegistrationController;
    };
  }>;
}

function createHttpClientConfigXapi(mode: 'On' | 'Off', allowInsecureHTTPS: 'True' | 'False') {
  const setMode = vi.fn(async () => undefined);
  const setAllowInsecureHTTPS = vi.fn(async () => undefined);
  return {
    xapi: {
      Config: {
        HttpClient: {
          Mode: {
            get: vi.fn(async () => mode),
            set: setMode,
          },
          AllowInsecureHTTPS: {
            get: vi.fn(async () => allowInsecureHTTPS),
            set: setAllowInsecureHTTPS,
          },
        },
      },
    },
    setMode,
    setAllowInsecureHTTPS,
  };
}

function createTransportXapi(options: { deviceWideAllowsInsecure: boolean }) {
  const requests: Array<{ method: 'GET' | 'POST'; parameters: Record<string, unknown> }> = [];
  const execute = async (
    method: 'GET' | 'POST',
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    requests.push({ method, parameters });
    const host = new URL(String(parameters.Url)).hostname;
    const destinationTrusted = host.startsWith('trusted.');
    const requestAsksForInsecure = parameters.AllowInsecureHTTPS === 'True';
    if (!destinationTrusted && !(options.deviceWideAllowsInsecure && requestAsksForInsecure)) {
      throw new Error('Certificate validation failed');
    }
    if (String(parameters.Url).includes('/Status/SystemUnit')) {
      return {
        StatusCode: 200,
        Body: '<Status><SystemUnit><Hardware><Module><SerialNumber>PARENT123</SerialNumber></Module></Hardware><BroadcastName>Parent Room</BroadcastName></SystemUnit></Status>',
      };
    }
    if (String(parameters.Url).includes('/Status/Standby/State')) {
      return { StatusCode: 200, Body: '<Status><Standby><State>Off</State></Standby></Status>' };
    }
    if (String(parameters.Url).includes('/Status/Call')) {
      return { StatusCode: 200, Body: '<Status><Call id="1"><CallId>1</CallId><Status>Connected</Status></Call></Status>' };
    }
    return { StatusCode: 200, Body: '<Command><Success/></Command>' };
  };
  const get = vi.fn((parameters: Record<string, unknown>) => execute('GET', parameters));
  const post: HttpClientPost = vi.fn((parameters: Record<string, unknown>) => execute('POST', parameters));
  return {
    xapi: {
      Command: {
        HttpClient: {
          Get: get,
          Post: post,
        },
      },
    },
    requests,
  };
}

function connection(host: string) {
  return {
    host,
    username: 'admin',
    password: 'secret',
  };
}

function buildInstallerRequest(transactionId: string, allowOverwrite = false) {
  return {
    Action: 'InstallerParentRegistrationRequest',
    Serial: 'COMPANION123',
    Source: { Role: 'Installer' },
    Payload: {
      TransactionId: transactionId,
      Parent: {
        Host: 'parent.example.test',
        Serial: 'PARENT123',
        Username: 'admin',
        Password: 'secret',
      },
      AllowOverwrite: allowOverwrite,
    },
  };
}

function buildInstallerDeregistrationRequest(transactionId: string) {
  return {
    Action: 'InstallerParentDeregistrationRequest',
    Serial: 'COMPANION123',
    Source: { Role: 'Installer' },
    Payload: {
      TransactionId: transactionId,
      ParentSerial: 'PARENT123',
    },
  };
}

async function createRegistrationHarness(options: {
  acknowledgeMessages: boolean;
  initializationError?: unknown;
  initializationGate?: Promise<void>;
}) {
  const { parentRegistration } = await loadParentRegistration();
  const sentMessages: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const infoLogs: unknown[] = [];
  const warnings: unknown[] = [];
  const parent = {
    host: 'parent.example.test',
    serial: 'PARENT123',
    name: 'Parent Room',
    username: 'admin',
    password: 'secret',
  };
  const companion = {
    host: 'companion.example.test',
    serial: 'COMPANION123',
    name: 'Companion Device',
    username: 'callback',
    password: 'callback-secret',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    productPlatform: 'Board Pro',
  };
  const syncConfig = {
    version: 'test-version',
    CompanionDeviceInformation: {
      host: companion.host,
      username: companion.username,
      password: companion.password,
    },
    UserInterface: {},
  };
  let controller: RegistrationController;
  const deviceComms = {
    parentInitializationRequest: vi.fn(async () => {
      await options.initializationGate;
      if (options.initializationError) throw options.initializationError;
      return parent;
    }),
    installParentMacros: vi.fn(async () => undefined),
    connectPeripheral: vi.fn(async () => undefined),
    sendPeripheralHeartbeat: vi.fn(async () => undefined),
    sendMessageCommand: vi.fn(async (
      _xapi: unknown,
      _device: unknown,
      action: string,
      payload: Record<string, unknown>,
    ) => {
      sentMessages.push({ action, payload });
      if (!options.acknowledgeMessages) return;
      if (action === 'ParentReadyRequest') {
        queueMicrotask(() => {
          void controller.handleMessage({
            Action: 'ParentReady',
            Serial: parent.serial,
            Payload: { TransactionId: payload.TransactionId },
          });
        });
      }
      if (action === 'ConfigSync') {
        queueMicrotask(() => {
          void controller.handleMessage({
            Action: 'ConfigAccepted',
            Serial: parent.serial,
            Payload: { TransactionId: payload.TransactionId },
          });
        });
      }
      if (action === 'DeregisterRequest') {
        queueMicrotask(() => {
          void controller.handleMessage({
            Action: 'DeregistrationAccepted',
            Serial: parent.serial,
            Payload: { TransactionId: payload.TransactionId },
          });
        });
      }
    }),
  };

  controller = parentRegistration.create({
    xapi: {},
    mem: { write: vi.fn(async () => undefined) },
    deviceComms,
    companionDeviceServices: {
      getParentInstallMacroPayloads: vi.fn(async () => []),
      buildCompanionPeripheralInfo: vi.fn(() => ({ ID: companion.macAddress })),
      getCompanionPeripheralId: vi.fn(() => companion.macAddress),
    },
    companionUi: {},
    pinModeController: {},
    parentDevicesStorageKey: 'parents',
    pendingStorageKey: 'pending',
    installConfig: {},
    configVersion: 'test-version',
    peripheralType: 'ControlSystem',
    initialHeartbeatTimeout: 3,
    installerRegistrationAction: 'InstallerParentRegistrationRequest',
    installerRegistrationProgressMessage: 'Companion Installer Parent Room Registration progress',
    installerRegistrationSuccessMessage: 'Companion Installer Parent Room Registration completed',
    installerRegistrationFailureMessage: 'Companion Installer Parent Room Registration failed',
    installerDeregistrationAction: 'InstallerParentDeregistrationRequest',
    installerDeregistrationProgressMessage: 'Companion Installer Parent Room Deregistration progress',
    installerDeregistrationSuccessMessage: 'Companion Installer Parent Room Deregistration completed',
    installerDeregistrationPendingMessage: 'Companion Installer Parent Room Deregistration pending',
    installerDeregistrationFailureMessage: 'Companion Installer Parent Room Deregistration failed',
    log: {
      debug: vi.fn(),
      info: vi.fn((value: unknown) => infoLogs.push(value)),
      warn: vi.fn((value: unknown) => warnings.push(value)),
      error: vi.fn(),
    },
    utils: {
      softError: vi.fn(),
    },
    policy: {
      maxParentDevices: 6,
      networkRetryMs: 5000,
    },
    callbacks: {
      getRuntimeContext: () => ({
        isUnhealthy: false,
        mode: 'Standalone',
        activeParentSerial: 'Standalone',
      }),
      isCompanionDeviceInActiveCall: vi.fn(async () => false),
      getRuntimeCompanionDeviceInformation: vi.fn(async () => companion),
      getParentSyncConfig: () => syncConfig,
      releaseActiveParentForDeregistration: vi.fn(async () => undefined),
      onStateChanged: vi.fn(async () => undefined),
    },
  });

  return {
    controller,
    infoLogs,
    parent,
    sentMessages,
    syncConfig,
    warnings,
  };
}

describe('administrator-owned HTTPClient prerequisites', () => {
  it.each([
    ['False', false, 'Strict certificate validation'],
    ['True', true, 'Untrusted/self-signed certificates permitted'],
  ] as const)('observes Mode=On with device-wide AllowInsecureHTTPS=%s without mutation', async (
    allowInsecureHTTPS,
    expectedAllowInsecureHTTPS,
    expectedTrustPosture,
  ) => {
    const deviceComms = await loadDeviceComms();
    const harness = createHttpClientConfigXapi('On', allowInsecureHTTPS);

    const result = await deviceComms.validateHttpClientPrerequisites(harness.xapi);

    expect(result).toEqual({
      mode: 'On',
      allowInsecureHTTPS: expectedAllowInsecureHTTPS,
      trustPosture: expectedTrustPosture,
    });
    expect(harness.setMode).not.toHaveBeenCalled();
    expect(harness.setAllowInsecureHTTPS).not.toHaveBeenCalled();
  });

  it('rejects Mode=Off without changing either device-wide configuration', async () => {
    const deviceComms = await loadDeviceComms();
    const harness = createHttpClientConfigXapi('Off', 'False');

    await expect(deviceComms.validateHttpClientPrerequisites(harness.xapi))
      .rejects.toMatchObject({ code: 'CC26-HTTPCLIENT-MODE' });
    expect(harness.setMode).not.toHaveBeenCalled();
    expect(harness.setAllowInsecureHTTPS).not.toHaveBeenCalled();
  });

  it('rejects a failed Mode read without attempting a write', async () => {
    const deviceComms = await loadDeviceComms();
    const harness = createHttpClientConfigXapi('On', 'False');
    harness.xapi.Config.HttpClient.Mode.get = vi.fn(async () => {
      throw new Error('Mode path unavailable');
    });

    await expect(deviceComms.validateHttpClientPrerequisites(harness.xapi))
      .rejects.toMatchObject({ code: 'CC26-HTTPCLIENT-MODE' });
    expect(harness.setMode).not.toHaveBeenCalled();
    expect(harness.setAllowInsecureHTTPS).not.toHaveBeenCalled();
  });
});

describe('fixed request-level HTTPClient policy', () => {
  it('sends AllowInsecureHTTPS=True on every real DeviceComms GET and POST seam', async () => {
    const deviceComms = await loadDeviceComms();
    deviceComms.initializeHttpTransport({ maxConcurrentRequests: 3 });
    const harness = createTransportXapi({ deviceWideAllowsInsecure: true });
    const device = connection('trusted.parent.example.test');

    await deviceComms.parentInitializationRequest(harness.xapi, device);
    await deviceComms.parentStandbyStateRequest(harness.xapi, device);
    await deviceComms.getCallStatus(harness.xapi, device);
    await deviceComms.connectPeripheral(harness.xapi, device, {
      ID: 'peripheral-1',
      Name: 'Companion',
      Type: 'ControlSystem',
    });
    await deviceComms.sendPeripheralHeartbeat(harness.xapi, device, 'peripheral-1', 40);
    await deviceComms.sendMessageCommand(harness.xapi, device, 'TestAction', {}, {
      serial: 'COMPANION123',
    });
    await deviceComms.installParentMacros(harness.xapi, device, {
      roomReference: '// room',
      parentCallCoordination: '// call',
      utils: '// utils',
      deviceComms: '// transport',
      memoryStorage: '// memory',
    }, {});

    expect(harness.requests.length).toBe(7);
    expect(harness.requests.every(({ parameters }) => parameters.AllowInsecureHTTPS === 'True')).toBe(true);
  });

  it('preserves the RoomOS device-wide gate semantics when each request asks for True', async () => {
    const deviceComms = await loadDeviceComms();
    deviceComms.initializeHttpTransport();
    const strictHarness = createTransportXapi({ deviceWideAllowsInsecure: false });
    await expect(deviceComms.parentInitializationRequest(
      strictHarness.xapi,
      connection('trusted.parent.example.test'),
    )).resolves.toMatchObject({ serial: 'PARENT123' });
    await expect(deviceComms.parentInitializationRequest(
      strictHarness.xapi,
      connection('self-signed.parent.example.test'),
    )).rejects.toMatchObject({
      code: 'CC26-HTTP-REQUEST',
      Context: {
        Cause: 'Certificate validation failed',
      },
    });

    const permissiveHarness = createTransportXapi({ deviceWideAllowsInsecure: true });
    await expect(deviceComms.parentInitializationRequest(
      permissiveHarness.xapi,
      connection('self-signed.parent.example.test'),
    )).resolves.toMatchObject({ serial: 'PARENT123' });
    expect(permissiveHarness.requests[0]?.parameters.AllowInsecureHTTPS).toBe('True');
  });
});

describe('runtime policy handoff removal', () => {
  it('suppresses older tombstone cleanup from accepted re-registration through identity verification', async () => {
    let releaseInitialization: () => void = () => undefined;
    const initializationGate = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    const harness = await createRegistrationHarness({
      acknowledgeMessages: true,
      initializationGate,
    });
    harness.controller.setState([], [{
      serial: harness.parent.serial,
      name: harness.parent.name,
      host: harness.parent.host,
      username: harness.parent.username,
      password: harness.parent.password,
      peripheralId: 'COMPANION123',
      transactionId: 'deregistration:older-intent',
      createdAt: '2026-07-27T12:00:00.000Z',
    }]);

    const registration = harness.controller.handleInstallerRegistrationRequest(
      buildInstallerRequest('installer-registration:newer-intent-1234', true),
    );
    await vi.waitFor(() => {
      expect(harness.infoLogs.length).toBeGreaterThan(0);
    });
    await harness.controller.handleMessage({
      Action: 'RegistrationValidation',
      Serial: harness.parent.serial,
      Payload: {},
    });

    expect(harness.sentMessages).not.toContainEqual(expect.objectContaining({
      action: 'DeregisterRequest',
    }));
    releaseInitialization();
    await registration;
  });

  it('retains the requested Parent host and actionable transport guidance when verification fails', async () => {
    const harness = await createRegistrationHarness({
      acknowledgeMessages: false,
      initializationError: Object.assign(new Error('RoomOS HTTP request failed before a valid response was received'), {
        code: 'CC26-HTTP-REQUEST',
        Context: {
          Host: 'parent.example.test',
          Cause: 'Certificate validation failed',
        },
      }),
    });

    await harness.controller.handleInstallerRegistrationRequest(
      buildInstallerRequest('installer-registration:verification-failure-1234'),
    );

    const outcome = harness.warnings
      .filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as Record<string, unknown>)
      .find((value) => value.Message === 'Companion Installer Parent Room Registration failed');
    expect(outcome).toMatchObject({
      Code: 'CC26-HTTP-REQUEST',
      Stage: 'Verifying Parent Room Device',
      Host: 'parent.example.test',
    });
    expect(outcome?.Detail).toMatch(/certificate|HTTPClient|HTTPS/i);
    const progress = harness.infoLogs
      .filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as Record<string, unknown>)
      .find((value) => value.Message === 'Companion Installer Parent Room Registration progress');
    expect(progress).toMatchObject({
      Stage: 'Verifying Parent Room Device',
      Step: 1,
      TotalSteps: 6,
      Host: 'parent.example.test',
    });
  });

  it('reports each Companion Device-owned deregistration stage to the installer', async () => {
    const harness = await createRegistrationHarness({ acknowledgeMessages: true });
    harness.controller.setState([harness.parent], []);

    await harness.controller.handleInstallerDeregistrationRequest(
      buildInstallerDeregistrationRequest('installer-deregistration:progress-test-1234'),
    );

    const progress = harness.infoLogs
      .filter((value): value is string => typeof value === 'string')
      .map((value) => JSON.parse(value) as Record<string, unknown>)
      .filter((value) => value.Message === 'Companion Installer Parent Room Deregistration progress');
    expect(progress).toMatchObject([
      {
        Stage: 'Saving Parent Room Deregistration',
        Step: 1,
        TotalSteps: 2,
        Host: harness.parent.host,
      },
      {
        Stage: 'Confirming Parent Room Deregistration',
        Step: 2,
        TotalSteps: 2,
        Host: harness.parent.host,
      },
    ]);
  });

  it('omits HTTPClient policy from ParentReady and ConfigSync', async () => {
    const harness = await createRegistrationHarness({ acknowledgeMessages: true });

    await harness.controller.handleInstallerRegistrationRequest(
      buildInstallerRequest('installer-registration:policy-test-1234'),
    );

    const parentReadyRequest = harness.sentMessages.find(({ action }) => action === 'ParentReadyRequest');
    const configSync = harness.sentMessages.find(({ action }) => action === 'ConfigSync');
    expect(parentReadyRequest?.payload).not.toHaveProperty('Config');
    expect(configSync?.payload.Config).toEqual(harness.syncConfig);
    expect(configSync?.payload.Config).not.toHaveProperty('httpClient');
  });

  it('reports certificate and HTTPClient remediation for a ParentReady timeout', async () => {
    vi.useFakeTimers();
    try {
      const harness = await createRegistrationHarness({ acknowledgeMessages: false });
      const registration = harness.controller.handleInstallerRegistrationRequest(
        buildInstallerRequest('installer-registration:timeout-test-1234'),
      );

      await vi.advanceTimersByTimeAsync(60_000);
      await registration;

      const outcome = harness.warnings
        .filter((value): value is string => typeof value === 'string')
        .map((value) => JSON.parse(value) as Record<string, unknown>)
        .find((value) => value.Message === 'Companion Installer Parent Room Registration failed');
      expect(outcome).toMatchObject({
        Code: 'CC26-REGISTRATION-TIMEOUT',
        Stage: 'Waiting for Parent Room Runtime',
        Host: harness.parent.host,
      });
      expect(outcome?.Detail).toMatch(/HttpClient Mode/i);
      expect(outcome?.Detail).toMatch(/certificate trust/i);
      expect(outcome?.Detail).toMatch(/hostname\/SAN/i);
      expect(outcome?.Detail).toMatch(/Parent-to-Companion reachability/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retain per-Companion HTTP policy selection in Parent runtime callers', async () => {
    const roomReferenceSource = await readFile(new URL('../../Custom-Campanion_7_RoomReference_2026.js', import.meta.url), 'utf8');
    const callCoordinationSource = await readFile(new URL('../../Custom-Campanion_12_ParentCallCoordination_2026.js', import.meta.url), 'utf8');

    expect(roomReferenceSource).not.toContain('getHttpClientConfigForCompanion');
    expect(callCoordinationSource).not.toContain('getHttpClientConfigForCompanion');
    expect(callCoordinationSource).not.toContain('dependencies.httpClientConfig');
  });
});

describe('source-driven Config compatibility', () => {
  it('removes the HTTPClient field from the current release Config', async () => {
    const source = await readFile(new URL('../../Custom-Campanion_2_Config_2026.js', import.meta.url), 'utf8');
    const document = parseConfigDocument(source);
    expect(document.leaves.some((leaf) => formatConfigPath(leaf.path) === 'httpClient.allowInsecureHTTPS')).toBe(false);
  });

  it('still discovers and edits the historical field from an older selected release', () => {
    const source = "const config = { httpClient: { allowInsecureHTTPS: false } }; export { config };";
    const document = parseConfigDocument(source);
    const leaf = document.leaves.find((candidate) => formatConfigPath(candidate.path) === 'httpClient.allowInsecureHTTPS');
    expect(leaf?.value).toBe(false);
    const values = new Map<string, ConfigValue>(document.leaves.map((candidate) => [
      configPathId(candidate.path),
      candidate.value,
    ]));
    if (!leaf) throw new Error('Legacy field was not parsed');
    values.set(configPathId(leaf.path), true);
    expect(patchConfigSource(document, values)).toContain('allowInsecureHTTPS: true');
  });
});
