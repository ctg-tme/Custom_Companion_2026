import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type RegistrationController = {
  handleInstallerRegistrationRequest: (message: Record<string, unknown>) => Promise<boolean>;
  handleMessage: (message: Record<string, unknown>) => Promise<boolean>;
};

async function loadParentRegistration() {
  const source = await readFile(new URL('../../Custom-Campanion_15_ParentRegistration_2026.js', import.meta.url), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl) as Promise<{
    parentRegistration: {
      create: (options: Record<string, unknown>) => RegistrationController;
    };
  }>;
}

function buildInstallerRequest(transactionId: string) {
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
    },
  };
}

async function createRegistrationHarness(options: { acknowledgeMessages: boolean }) {
  const { parentRegistration } = await loadParentRegistration();
  const sentMessages: Array<{ action: string; payload: Record<string, unknown> }> = [];
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
    httpClient: {
      allowInsecureHTTPS: true,
    },
    UserInterface: {},
  };
  let controller: RegistrationController;
  const deviceComms = {
    parentInitializationRequest: vi.fn(async () => parent),
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
      if (!options.acknowledgeMessages) {
        return;
      }
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
    httpClientConfig: {
      mode: 'On',
      allowInsecureHTTPS: true,
      maxConcurrentRequests: 3,
    },
    installConfig: {},
    configVersion: 'test-version',
    peripheralType: 'ControlSystem',
    initialHeartbeatTimeout: 3,
    installerRegistrationAction: 'InstallerParentRegistrationRequest',
    installerRegistrationSuccessMessage: 'Companion Installer Parent Room Registration completed',
    installerRegistrationFailureMessage: 'Companion Installer Parent Room Registration failed',
    log: {
      debug: vi.fn(),
      info: vi.fn(),
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
    parent,
    sentMessages,
    syncConfig,
    warnings,
  };
}

describe('runtime HTTPClient policy handoff', () => {
  it('bootstraps ParentReady with the Companion Device HTTPClient policy', async () => {
    const harness = await createRegistrationHarness({ acknowledgeMessages: true });

    await harness.controller.handleInstallerRegistrationRequest(
      buildInstallerRequest('installer-registration:policy-test-1234'),
    );

    const parentReadyRequest = harness.sentMessages.find(({ action }) => action === 'ParentReadyRequest');
    expect(parentReadyRequest?.payload).toMatchObject({
      Config: {
        httpClient: harness.syncConfig.httpClient,
      },
    });
  });

  it('reports the timed-out registration stage and Parent Room Device host', async () => {
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
      expect(outcome?.Detail).toContain('Waiting for Parent Room Runtime');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Parent-to-Companion HTTP requests under per-Companion policy', async () => {
    const roomReferenceSource = await readFile(new URL('../../Custom-Campanion_7_RoomReference_2026.js', import.meta.url), 'utf8');
    const callCoordinationSource = await readFile(new URL('../../Custom-Campanion_12_ParentCallCoordination_2026.js', import.meta.url), 'utf8');

    expect(roomReferenceSource).toContain('getHttpClientConfigForCompanion');
    expect(roomReferenceSource).not.toContain('}, HTTP_CLIENT_CONFIG);');
    expect(callCoordinationSource).toContain('getHttpClientConfigForCompanion(companionDevice.Serial)');
  });
});
