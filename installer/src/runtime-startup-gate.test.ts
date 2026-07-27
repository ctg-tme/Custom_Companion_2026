import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const HTTPCLIENT_MODE_MESSAGE = 'Custom Companion is unavailable because device-to-device communication is disabled. Ask a Device Administrator to enable HTTPClient Mode and restart the Macro Runtime.';

type GateOutcome = 'on' | 'off' | 'read-failure';

async function runCompanionMain(options: {
  gateOutcome: GateOutcome;
  failWebWidget?: boolean;
  failMemoryAfterGate?: boolean;
}) {
  const source = await readFile(new URL('../../Custom-Campanion_1_Main_2026.js', import.meta.url), 'utf8');
  const executable = source
    .replace(/^import[^;]+;\n/gm, '')
    .replace(/\ninit\(\);\s*$/, '\nglobalThis.initializationPromise = init();');

  const hardErrors: Array<Record<string, unknown>> = [];
  const warnLogs: unknown[][] = [];
  const errorLogs: unknown[][] = [];
  const setTimeoutSpy = vi.fn(() => 1);
  const memInit = vi.fn(async () => {
    if (options.failMemoryAfterGate) throw new Error('Stop after the prerequisite gate');
  });
  const initializeHttpTransport = vi.fn();
  const validateHttpClientPrerequisites = vi.fn(async () => {
    if (options.gateOutcome === 'off' || options.gateOutcome === 'read-failure') {
      const error = new Error(options.gateOutcome === 'off' ? 'Mode is Off' : 'Mode read failed') as Error & { code: string };
      error.code = 'CC26-HTTPCLIENT-MODE';
      throw error;
    }
    return {
      mode: 'On',
      allowInsecureHTTPS: false,
      trustPosture: 'Strict certificate validation',
    };
  });
  const saveErrorPanel = vi.fn(async () => undefined);
  const savePanel = vi.fn(async () => undefined);
  const runtimeInfoSnapshots: string[] = [];
  let getPairedRuntimeContext: (() => Record<string, unknown>) | undefined;

  class FakeLogger {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn((...args: unknown[]) => warnLogs.push(args));
    error = vi.fn((...args: unknown[]) => errorLogs.push(args));
  }

  class FakeMemoryStorage {
    init = memInit;
    read = vi.fn(async () => {
      const error = new Error('Not found') as Error & { code: string };
      error.code = 'msfv2.r.3';
      throw error;
    });
    write = vi.fn(async () => undefined);
  }

  const eventPath = () => ({ on: vi.fn() });
  const xapi = {
    Event: {
      Message: { Send: eventPath() },
      UserInterface: {
        Extensions: {
          Widget: { Action: eventPath() },
          Panel: { Clicked: eventPath() },
          Event: {
            PageOpened: eventPath(),
            PageClosed: eventPath(),
          },
        },
        Message: {
          Prompt: {
            Response: eventPath(),
            Cleared: eventPath(),
          },
          TextInput: {
            Response: eventPath(),
            Clear: eventPath(),
          },
        },
      },
    },
  };

  const pinModeController = {
    stop: vi.fn(async () => undefined),
    initialize: vi.fn(async () => undefined),
    isEnabled: vi.fn(() => false),
    handlePageOpened: vi.fn(),
    handlePageClosed: vi.fn(),
    handlePromptResponse: vi.fn(async () => false),
    handlePromptCleared: vi.fn(async () => false),
    handleTextInputResponse: vi.fn(async () => false),
    handleTextInputCleared: vi.fn(),
    handlePanelClicked: vi.fn(async () => false),
    handleWidgetAction: vi.fn(async () => false),
  };
  const parentConnectivityController = {
    refresh: vi.fn(async () => undefined),
    start: vi.fn(),
    stop: vi.fn(),
    evaluate: vi.fn(async () => undefined),
    getInfoText: vi.fn(() => 'connectivity message'),
    isCallPreservationActive: vi.fn(() => false),
    handleCallEnded: vi.fn(async () => false),
  };
  const standbyController = {
    initializeConfig: vi.fn(async () => undefined),
    setStandaloneConfig: vi.fn(),
    applyMode: vi.fn(async () => undefined),
    getInfoText: vi.fn(() => 'standby message'),
    clear: vi.fn(async () => undefined),
    handleMessage: vi.fn(async () => false),
  };
  const callSyncController = {
    registerCallCountHandler: vi.fn(),
    registerAuthenticationRequestHandler: vi.fn(),
    initializeActiveCallCount: vi.fn(async () => undefined),
    initializeAuthenticationRequest: vi.fn(async () => undefined),
    requestActiveParentCallState: vi.fn(async () => undefined),
    getInfoText: vi.fn(() => 'call message'),
    handleMessage: vi.fn(async () => false),
    handleMeetingPasswordResponse: vi.fn(async () => false),
  };
  const registrationController = {
    setState: vi.fn(),
    getState: vi.fn(() => ({ parentDevices: [], pendingDeregistrations: [] })),
    reconcileStoredConflicts: vi.fn(async () => undefined),
    reconcilePendingDeregistrations: vi.fn(async () => undefined),
    handleInstallerInventoryRequest: vi.fn(async () => false),
    handleInstallerDeregistrationRequest: vi.fn(async () => false),
    handleInstallerRegistrationRequest: vi.fn(async () => false),
    handleMessage: vi.fn(async () => false),
    handleTextInputCleared: vi.fn(),
    handlePromptResponse: vi.fn(async () => false),
    handlePromptCleared: vi.fn(async () => false),
    handleTextInputResponse: vi.fn(async () => false),
    handlePanelClicked: vi.fn(async () => false),
    handleWidgetAction: vi.fn(async () => false),
  };
  const pairedController = {
    registerMediaHandlers: vi.fn(),
    initializeUiFeatureMode: vi.fn(async () => undefined),
    setStandaloneUiFeatureConfig: vi.fn(),
    setStandaloneEnvironmentConfig: vi.fn(),
    applyUiFeatureMode: vi.fn(async () => undefined),
    enforceInitialMediaState: vi.fn(async () => undefined),
    isCallPreservationActive: vi.fn(() => false),
    handlePromptResponse: vi.fn(async () => false),
    applyRuntimeWebWidget: vi.fn(async () => {
      if (!getPairedRuntimeContext) throw new Error('Missing runtime context');
      runtimeInfoSnapshots.push(String(getPairedRuntimeContext().runtimeInfo3 ?? ''));
      if (options.failWebWidget) throw new Error('WebWidget unavailable');
    }),
  };

  const companionDeviceServices = {
    installParentMacrosOnOnlineParents: vi.fn(async () => undefined),
    connectPeripheralToOnlineParents: vi.fn(async () => ''),
    getRuntimeCompanionDeviceInformation: vi.fn(async () => ({
      host: 'companion.example.test',
      username: 'callback',
      password: 'secret',
      serial: 'COMPANION123',
      name: 'Companion',
      macAddress: 'AA:BB:CC:DD:EE:FF',
    })),
    getCompanionPeripheralId: vi.fn(() => 'AA:BB:CC:DD:EE:FF'),
  };

  const context = vm.createContext({
    xapi,
    MemoryStorage: FakeMemoryStorage,
    config: {
      CompanionDeviceInformation: {
        host: 'companion.example.test',
        username: 'callback',
        password: 'secret',
      },
      pinMode: {
        defaults: {
          enabled: true,
          pin: '0000',
        },
      },
      UserInterface: {
        WebWidget: {
          CompanionWidget: {
            enabled: true,
          },
        },
      },
    },
    projectVersion: 'test-version',
    utils: {
      Logger: FakeLogger,
      softError: vi.fn(),
      hardError: vi.fn((diagnostic: Record<string, unknown>) => {
        hardErrors.push(diagnostic);
        const cause = diagnostic.Error;
        const error = cause instanceof Error ? cause : new Error(String(diagnostic.Context ?? 'Hard error'));
        Object.assign(error, {
          code: diagnostic.Code,
          Diagnostic: diagnostic,
        });
        throw error;
      }),
    },
    companionUi: {
      saveErrorPanel,
      savePanel,
    },
    companionState: {
      STANDALONE_PARENT_SERIAL: 'Standalone',
      PIN_MODE_STORAGE_KEY: 'pin',
      PARENT_DEVICES_STORAGE_KEY: 'parents',
      PENDING_DEREGISTRATIONS_STORAGE_KEY: 'pending',
      ACTIVE_PARENT_SERIAL_STORAGE_KEY: 'active',
      STANDALONE_UI_FEATURE_CONFIG_STORAGE_KEY: 'ui',
      STANDALONE_PAIRED_ENVIRONMENT_CONFIG_STORAGE_KEY: 'environment',
      STANDALONE_STANDBY_CONFIG_STORAGE_KEY: 'standby',
      createCompanionDeviceState: vi.fn(() => ({
        mode: 'Standalone',
        activeParent: {
          host: '',
          name: 'Standalone',
        },
      })),
      readMemoryOrDefault: vi.fn(async (_mem: unknown, _key: string, fallback: unknown) => fallback),
      readMemoryOrInitialize: vi.fn(async (_mem: unknown, _key: string, fallback: unknown) => fallback),
      normalizeActiveParentSerial: vi.fn((value: string) => value),
      warnIfCredentialsAreStored: vi.fn(),
      findActiveParentDevice: vi.fn(() => null),
      findParentDeviceByHost: vi.fn(() => null),
    },
    deviceComms: {
      initializeHttpTransport,
      validateHttpClientPrerequisites,
      parseCompanionMessage: vi.fn(() => null),
      sendMessageCommand: vi.fn(async () => undefined),
    },
    companionDeviceServices,
    parentConnectivity: {
      create: vi.fn(() => parentConnectivityController),
    },
    pairedEnvironment: {
      create: vi.fn((factoryOptions: { callbacks: { getRuntimeContext: () => Record<string, unknown> } }) => {
        getPairedRuntimeContext = factoryOptions.callbacks.getRuntimeContext;
        return pairedController;
      }),
    },
    companionDeviceCallSync: {
      create: vi.fn(() => callSyncController),
    },
    standbyCoordination: {
      create: vi.fn(() => standbyController),
    },
    pinMode: {
      create: vi.fn(() => pinModeController),
    },
    parentRegistration: {
      create: vi.fn(() => registrationController),
    },
    console: {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    Promise,
    Date,
    Error,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    RegExp,
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn(),
    btoa: (value: string) => Buffer.from(value).toString('base64'),
  });

  vm.runInContext(executable, context);
  await (context.initializationPromise as Promise<void>);

  return {
    hardErrors,
    warnLogs,
    errorLogs,
    setTimeoutSpy,
    memInit,
    initializeHttpTransport,
    validateHttpClientPrerequisites,
    saveErrorPanel,
    savePanel,
    runtimeInfoSnapshots,
    getPairedRuntimeContext,
    parentConnectivityController,
    standbyController,
    callSyncController,
    registrationController,
    companionDeviceServices,
  };
}

async function runParentRoomReference(gateOutcome: GateOutcome) {
  const source = await readFile(new URL('../../Custom-Campanion_7_RoomReference_2026.js', import.meta.url), 'utf8');
  const executable = source
    .replace(/^import[^;]+;\n/gm, '')
    .replace(/\ninit\(\);\s*$/, '\nglobalThis.initializationPromise = init();');
  const hardErrors: Array<Record<string, unknown>> = [];
  const memInit = vi.fn(async () => undefined);
  const initializeHttpTransport = vi.fn();
  const validateHttpClientPrerequisites = vi.fn(async () => {
    if (gateOutcome !== 'on') {
      const error = new Error(gateOutcome === 'off' ? 'Mode is Off' : 'Mode read failed') as Error & { code: string };
      error.code = 'CC26-HTTPCLIENT-MODE';
      throw error;
    }
    return {
      mode: 'On',
      allowInsecureHTTPS: false,
      trustPosture: 'Strict certificate validation',
    };
  });
  const parentStart = vi.fn(async () => undefined);
  const messageSubscription = vi.fn();
  const standbySubscription = vi.fn();
  const setTimeoutSpy = vi.fn(() => 1);

  class FakeLogger {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  }

  class FakeMemoryStorage {
    init = memInit;
    read = vi.fn(async () => []);
    write = vi.fn(async () => undefined);
  }

  const context = vm.createContext({
    xapi: {
      Event: {
        Message: {
          Send: {
            on: messageSubscription,
          },
        },
      },
      Status: {
        Standby: {
          State: {
            on: standbySubscription,
          },
        },
      },
    },
    MemoryStorage: FakeMemoryStorage,
    utils: {
      Logger: FakeLogger,
      softError: vi.fn(),
      hardError: vi.fn((diagnostic: Record<string, unknown>) => {
        hardErrors.push(diagnostic);
        const cause = diagnostic.Error;
        const error = cause instanceof Error ? cause : new Error(String(diagnostic.Context ?? 'Hard error'));
        Object.assign(error, {
          code: diagnostic.Code,
          Diagnostic: diagnostic,
        });
        throw error;
      }),
    },
    deviceComms: {
      initializeHttpTransport,
      validateHttpClientPrerequisites,
    },
    parentCallCoordination: {
      create: vi.fn(() => ({
        start: parentStart,
        setRegisteredCompanionDevices: vi.fn(),
      })),
    },
    console: {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    Promise,
    Date,
    Error,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    JSON,
    RegExp,
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn(),
  });

  vm.runInContext(executable, context);
  await (context.initializationPromise as Promise<void>);
  return {
    hardErrors,
    memInit,
    initializeHttpTransport,
    validateHttpClientPrerequisites,
    parentStart,
    messageSubscription,
    standbySubscription,
    setTimeoutSpy,
  };
}

describe('mandatory Companion Device startup gate', () => {
  it('allows initialization to continue past the gate only when Mode=On', async () => {
    const harness = await runCompanionMain({
      gateOutcome: 'on',
      failMemoryAfterGate: true,
    });

    expect(harness.validateHttpClientPrerequisites).toHaveBeenCalledTimes(1);
    expect(harness.initializeHttpTransport).toHaveBeenCalledTimes(1);
    expect(harness.memInit).toHaveBeenCalledTimes(1);
    expect(harness.hardErrors.some((diagnostic) => diagnostic.Code === 'CC26-INIT-HTTPCLIENT-MODE')).toBe(false);
  });

  it.each(['off', 'read-failure'] as const)('stops %s before controllers, timers, or network work', async (gateOutcome) => {
    const harness = await runCompanionMain({ gateOutcome });

    expect(harness.hardErrors).toHaveLength(1);
    expect(harness.hardErrors[0]).toMatchObject({
      Code: 'CC26-INIT-HTTPCLIENT-MODE',
      Component: 'CompanionDeviceMain',
      Context: 'RoomOS HTTPClient Mode is unavailable or disabled.',
      Remediation: 'A Device Administrator must set xConfiguration HttpClient Mode: On and restart the Macro Runtime.',
    });
    expect(harness.initializeHttpTransport).not.toHaveBeenCalled();
    expect(harness.memInit).not.toHaveBeenCalled();
    expect(harness.parentConnectivityController.refresh).not.toHaveBeenCalled();
    expect(harness.parentConnectivityController.start).not.toHaveBeenCalled();
    expect(harness.parentConnectivityController.evaluate).not.toHaveBeenCalled();
    expect(harness.registrationController.reconcilePendingDeregistrations).not.toHaveBeenCalled();
    expect(harness.companionDeviceServices.installParentMacrosOnOnlineParents).not.toHaveBeenCalled();
    expect(harness.companionDeviceServices.connectPeripheralToOnlineParents).not.toHaveBeenCalled();
    expect(harness.setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('renders only cc26_error and preserves the cause-specific Unhealthy precedence', async () => {
    const harness = await runCompanionMain({ gateOutcome: 'off' });

    expect(harness.saveErrorPanel).toHaveBeenCalledTimes(1);
    expect(harness.savePanel).not.toHaveBeenCalled();
    expect(harness.runtimeInfoSnapshots).toEqual([HTTPCLIENT_MODE_MESSAGE]);
    expect(harness.getPairedRuntimeContext?.().runtimeInfo3).toBe(HTTPCLIENT_MODE_MESSAGE);
  });

  it('logs an unavailable WebWidget without raising a second hard error', async () => {
    const harness = await runCompanionMain({
      gateOutcome: 'off',
      failWebWidget: true,
    });

    expect(harness.hardErrors).toHaveLength(1);
    expect(harness.runtimeInfoSnapshots).toEqual([HTTPCLIENT_MODE_MESSAGE]);
    expect(harness.warnLogs.some(([entry]) => (
      typeof entry === 'object'
      && entry !== null
      && (entry as Record<string, unknown>).Code === 'CC26-UNHEALTHY-INFO3'
    ))).toBe(true);
  });
});

describe('mandatory Parent Room startup gate', () => {
  it('allows Parent Room initialization to continue past the gate when Mode=On', async () => {
    const harness = await runParentRoomReference('on');

    expect(harness.validateHttpClientPrerequisites).toHaveBeenCalledTimes(1);
    expect(harness.initializeHttpTransport).toHaveBeenCalledTimes(1);
    expect(harness.memInit).toHaveBeenCalledTimes(1);
    expect(harness.parentStart).toHaveBeenCalledTimes(1);
    expect(harness.hardErrors).toHaveLength(0);
  });

  it.each(['off', 'read-failure'] as const)('stops %s before Parent workflows or timers start', async (gateOutcome) => {
    const harness = await runParentRoomReference(gateOutcome);

    expect(harness.hardErrors).toHaveLength(1);
    expect(harness.hardErrors[0]).toMatchObject({
      Code: 'CC26-INIT-HTTPCLIENT-MODE',
      Component: 'RoomReference',
      Context: 'RoomOS HTTPClient Mode is unavailable or disabled.',
      Remediation: 'A Device Administrator must set xConfiguration HttpClient Mode: On and restart the Macro Runtime.',
    });
    expect(harness.initializeHttpTransport).not.toHaveBeenCalled();
    expect(harness.memInit).not.toHaveBeenCalled();
    expect(harness.parentStart).not.toHaveBeenCalled();
    expect(harness.messageSubscription).not.toHaveBeenCalled();
    expect(harness.standbySubscription).not.toHaveBeenCalled();
    expect(harness.setTimeoutSpy).not.toHaveBeenCalled();
  });
});
