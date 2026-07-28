import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type CompanionRecord = {
  Serial: string;
  Name: string;
  Host: string;
  Username: string;
  Password: string;
};

type PairingState = 'Paired' | 'NotPaired';

type RegistrationValidationTestApi = {
  setState: (registered: CompanionRecord[], pairingStates: Record<string, { State: PairingState }>) => void;
  getState: () => {
    pairingStates: Record<string, { State: PairingState }>;
    reachability: Record<string, string>;
  };
  getPendingValidation: () => { serial: string; transactionId: string } | null;
  createWaiter: (serial: string, transactionId: string) => { promise: Promise<unknown> };
  handleRegistrationValidated: (message: Record<string, unknown>) => Promise<void>;
  validateAll: () => Promise<void>;
};

function validationResponse(
  serial: string,
  transactionId: string,
  pairingState?: string,
  status = 'Registered',
): Record<string, unknown> {
  return {
    Action: 'RegistrationValidated',
    Serial: serial,
    Payload: {
      TransactionId: transactionId,
      Status: status,
      ...(pairingState === undefined ? {} : { PairingState: pairingState }),
    },
  };
}

async function loadHarness() {
  const source = await readFile(
    new URL('../../Custom-Campanion_7_RoomReference_2026.js', import.meta.url),
    'utf8',
  );
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const memoryWrite = vi.fn(async (_key: string, _value: unknown) => undefined);
  const sendMessageCommand = vi.fn(async (
    _xapi: unknown,
    _target: { host: string },
    _action: string,
    _payload: { TransactionId: string },
  ) => undefined);
  const xapi = {
    Command: {
      UserInterface: {
        Extensions: {
          Icon: {
            Download: vi.fn(async () => ({ IconId: 'test-icon' })),
          },
          Panel: {
            Save: vi.fn(async () => undefined),
            Update: vi.fn(async () => undefined),
          },
        },
        Message: {
          Alert: {
            Display: vi.fn(async () => undefined),
          },
          Prompt: {
            Display: vi.fn(async () => undefined),
          },
        },
      },
      Peripherals: {
        Purge: vi.fn(async () => undefined),
      },
    },
    Config: {
      HttpClient: {
        Mode: { get: vi.fn(async () => 'On') },
        AllowInsecureHTTPS: { get: vi.fn(async () => 'False') },
      },
    },
    Event: {
      Message: {
        Send: { on: vi.fn() },
      },
    },
    Status: {
      Peripherals: {
        ConnectedDevice: { get: vi.fn(async () => []) },
      },
      Standby: {
        State: { on: vi.fn() },
      },
      SystemUnit: {
        BroadcastName: { get: vi.fn(async () => 'Parent Room') },
        Hardware: {
          Module: {
            SerialNumber: { get: vi.fn(async () => 'PARENT1') },
          },
        },
      },
    },
  };
  class MemoryStorage {
    async init() {}

    async read() {
      return undefined;
    }

    async write(key: string, value: unknown) {
      return memoryWrite(key, value);
    }
  }
  class Logger {
    constructor() {
      return logger;
    }
  }
  const harnessKey = `__roomReferenceValidation_${Date.now()}_${Math.random()}`;
  Object.assign(globalThis, {
    [harnessKey]: {
      xapi,
      MemoryStorage,
      utils: {
        Logger,
        hardError: vi.fn(),
        softError: vi.fn(),
      },
      deviceComms: {
        initializeHttpTransport: vi.fn(),
        parseCompanionMessage: vi.fn(),
        sendMessageCommand,
      },
      parentCallCoordination: {
        create: () => ({
          handleActiveCallDetailsRequest: vi.fn(),
          handleMeetingPasswordRequest: vi.fn(),
          setRegisteredCompanionDevices: vi.fn(),
          start: vi.fn(async () => undefined),
        }),
      },
    },
  });

  const executableSource = source
    .replace(/^import .*;\n/gm, '')
    .replace(/\ninit\(\);\s*$/, '')
    .concat(`
export const registrationValidationTestApi = {
  setState(registered, pairingStates) {
    cancelPendingRegistrationValidation();
    registeredCompanionDevices = registered.slice();
    companionDevicePairingStates = { ...pairingStates };
    companionDeviceReachability = {};
    isStartupValidationCollecting = false;
    startupAlertCandidates = createStartupAlertCandidates();
  },
  getState() {
    return {
      pairingStates: companionDevicePairingStates,
      reachability: companionDeviceReachability
    };
  },
  getPendingValidation() {
    return pendingRegistrationValidation
      ? {
        serial: pendingRegistrationValidation.serial,
        transactionId: pendingRegistrationValidation.transactionId
      }
      : null;
  },
  createWaiter: createRegistrationValidationWaiter,
  handleRegistrationValidated,
  validateAll: validateRegisteredCompanionDevices
};
`);
  const prelude = `const { xapi, MemoryStorage, utils, deviceComms, parentCallCoordination } = globalThis[${JSON.stringify(harnessKey)}];\n`;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(prelude + executableSource).toString('base64')}#${harnessKey}`;
  const module = await import(moduleUrl) as {
    registrationValidationTestApi: RegistrationValidationTestApi;
  };

  return {
    api: module.registrationValidationTestApi,
    logger,
    memoryWrite,
    sendMessageCommand,
  };
}

function companion(serial: string): CompanionRecord {
  return {
    Serial: serial,
    Name: serial,
    Host: `${serial.toLowerCase()}.example.test`,
    Username: 'callback',
    Password: 'not-a-real-password',
  };
}

describe('Parent Room RegistrationValidated compatibility', () => {
  it.each<PairingState>(['Paired', 'NotPaired'])(
    'accepts a 0.1.2.51-style response and retains the saved %s state',
    async (savedState) => {
      const { api, memoryWrite } = await loadHarness();
      api.setState([companion('LEGACY1')], {
        LEGACY1: { State: savedState },
      });
      const waiter = api.createWaiter('LEGACY1', 'legacy-transaction');
      const response = validationResponse('LEGACY1', 'legacy-transaction');

      await api.handleRegistrationValidated(response);

      await expect(waiter.promise).resolves.toBe(response);
      expect(api.getState()).toEqual({
        pairingStates: { LEGACY1: { State: savedState } },
        reachability: { LEGACY1: 'Online' },
      });
      expect(memoryWrite).not.toHaveBeenCalled();
    },
  );

  it.each<PairingState>(['Paired', 'NotPaired'])(
    'applies a current authoritative %s response',
    async (pairingState) => {
      const { api } = await loadHarness();
      const previousState = pairingState === 'Paired' ? 'NotPaired' : 'Paired';
      api.setState([companion('CURRENT1')], {
        CURRENT1: { State: previousState },
      });
      const waiter = api.createWaiter('CURRENT1', 'current-transaction');
      const response = validationResponse('CURRENT1', 'current-transaction', pairingState);

      await api.handleRegistrationValidated(response);

      await expect(waiter.promise).resolves.toBe(response);
      expect(api.getState().pairingStates.CURRENT1?.State).toBe(pairingState);
      expect(api.getState().reachability.CURRENT1).toBe('Online');
    },
  );

  it('rejects an explicitly invalid PairingState without resolving the waiter', async () => {
    const { api, logger } = await loadHarness();
    api.setState([companion('CURRENT1')], {
      CURRENT1: { State: 'Paired' },
    });
    api.createWaiter('CURRENT1', 'invalid-state-transaction');

    await api.handleRegistrationValidated(
      validationResponse('CURRENT1', 'invalid-state-transaction', 'Unknown'),
    );

    expect(api.getPendingValidation()).toEqual({
      serial: 'CURRENT1',
      transactionId: 'invalid-state-transaction',
    });
    expect(api.getState().pairingStates.CURRENT1?.State).toBe('Paired');
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      PairingState: 'Unknown',
    }));
  });

  it('does not resolve for an unknown serial, mismatched transaction, or non-Registered status', async () => {
    const { api } = await loadHarness();
    api.setState([companion('EXPECTED1')], {
      EXPECTED1: { State: 'NotPaired' },
    });
    const waiter = api.createWaiter('EXPECTED1', 'expected-transaction');

    await api.handleRegistrationValidated(
      validationResponse('UNKNOWN1', 'expected-transaction'),
    );
    await api.handleRegistrationValidated(
      validationResponse('EXPECTED1', 'other-transaction'),
    );
    await api.handleRegistrationValidated(
      validationResponse('EXPECTED1', 'expected-transaction', undefined, 'Malformed'),
    );

    expect(api.getPendingValidation()).toEqual({
      serial: 'EXPECTED1',
      transactionId: 'expected-transaction',
    });

    const validResponse = validationResponse('EXPECTED1', 'expected-transaction');
    await api.handleRegistrationValidated(validResponse);
    await expect(waiter.promise).resolves.toBe(validResponse);
  });

  it('validates legacy and current Companion Devices on one shared Parent without retries', async () => {
    const { api, sendMessageCommand } = await loadHarness();
    api.setState([companion('LEGACY1'), companion('CURRENT1')], {
      LEGACY1: { State: 'Paired' },
      CURRENT1: { State: 'NotPaired' },
    });
    sendMessageCommand.mockImplementation(async (_xapi, target, action, payload) => {
      if (action !== 'RegistrationValidation') return;
      const serial = target.host.startsWith('legacy1') ? 'LEGACY1' : 'CURRENT1';
      const response = serial === 'LEGACY1'
        ? validationResponse(serial, payload.TransactionId)
        : validationResponse(serial, payload.TransactionId, 'Paired');
      queueMicrotask(() => {
        void api.handleRegistrationValidated(response);
      });
    });

    await api.validateAll();

    expect(sendMessageCommand).toHaveBeenCalledTimes(2);
    expect(api.getState()).toEqual({
      pairingStates: {
        LEGACY1: { State: 'Paired' },
        CURRENT1: expect.objectContaining({ State: 'Paired' }),
      },
      reachability: {
        LEGACY1: 'Online',
        CURRENT1: 'Online',
      },
    });
  });

  it('keeps the existing retry and Offline behavior when no response arrives', async () => {
    vi.useFakeTimers();
    try {
      const { api, sendMessageCommand } = await loadHarness();
      api.setState([companion('SILENT1')], {
        SILENT1: { State: 'Paired' },
      });

      const validation = api.validateAll();
      await vi.runAllTimersAsync();
      await validation;

      expect(sendMessageCommand).toHaveBeenCalledTimes(3);
      expect(api.getState()).toEqual({
        pairingStates: { SILENT1: { State: 'Paired' } },
        reachability: { SILENT1: 'Offline' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
