import { describe, expect, it, vi } from 'vitest';
import type { CompanionDeviceXapi } from './device';
import {
  ParentAdministrationMonitor,
  ParentDeregistrationOperation,
  createParentDeregistrationRequest,
  createParentInventoryRequest,
  parentInventoryPlanAfterInstallation,
  sendParentAdministrationRequest,
} from './parent-administration';
import {
  INSTALLER_PARENT_DEREGISTRATION_ACTION,
  INSTALLER_PARENT_DEREGISTRATION_FAILURE_MESSAGE,
  INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE,
  INSTALLER_PARENT_DEREGISTRATION_PROGRESS_MESSAGE,
  INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
  INSTALLER_PARENT_INVENTORY_ACTION,
  INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE,
} from './types';

describe('installer Parent Room administration requests', () => {
  it('treats Fresh Installation as a known-empty inventory without a runtime request', () => {
    expect(parentInventoryPlanAfterInstallation('fresh', true)).toEqual({
      inventory: { registered: [], pending: [] },
      shouldRequest: false,
    });
    expect(parentInventoryPlanAfterInstallation('preserve', true)).toEqual({
      inventory: { registered: [], pending: [] },
      shouldRequest: true,
    });
  });

  it('never requests inventory when the selected release does not declare it', () => {
    expect(parentInventoryPlanAfterInstallation('preserve', false)).toEqual({
      inventory: { registered: [], pending: [] },
      shouldRequest: false,
    });
  });

  it('requests a credential-free inventory for the verified Companion Device', () => {
    const request = createParentInventoryRequest('companion-456');
    const payload = JSON.parse(request.text) as Record<string, unknown>;

    expect(payload).toMatchObject({
      App: 'Companion Board 2026',
      Action: INSTALLER_PARENT_INVENTORY_ACTION,
      Serial: 'COMPANION456',
      Source: { Role: 'Installer', Name: 'Custom Companion Installer' },
      Payload: { TransactionId: request.transactionId },
    });
    expect(request.text).not.toMatch(/Password|Username/);
  });

  it('requests Companion Device-owned deregistration for one normalized parent serial', () => {
    const request = createParentDeregistrationRequest('companion-456', 'parent-123');
    const payload = JSON.parse(request.text) as Record<string, unknown>;

    expect(payload).toMatchObject({
      Action: INSTALLER_PARENT_DEREGISTRATION_ACTION,
      Serial: 'COMPANION456',
      Payload: {
        TransactionId: request.transactionId,
        ParentSerial: 'PARENT123',
      },
    });
  });

  it('sends each request through the existing Companion Device connection', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const request = createParentInventoryRequest('companion-456');

    await sendParentAdministrationRequest(
      { command } as unknown as CompanionDeviceXapi,
      request,
    );

    expect(command).toHaveBeenCalledWith('Message Send', { Text: request.text });
  });
});

describe('Parent Room administration monitor', () => {
  it('reports transaction-correlated deregistration stages before the terminal result', () => {
    let listener: ((event: unknown) => void) | undefined;
    const onProgress = vi.fn();
    const xapi = {
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return vi.fn();
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const monitor = new ParentAdministrationMonitor(
      xapi,
      'installer-deregistration:progress',
      onProgress,
    );

    listener?.({
      Message: JSON.stringify({
        Message: INSTALLER_PARENT_DEREGISTRATION_PROGRESS_MESSAGE,
        TransactionId: 'installer-deregistration:progress',
        Stage: 'Confirming Parent Room Deregistration',
        Detail: 'Waiting for remote cleanup.',
        Step: 2,
        TotalSteps: 2,
        Host: 'parent.example.com',
      }),
    });

    expect(onProgress).toHaveBeenCalledWith({
      stage: 'Confirming Parent Room Deregistration',
      detail: 'Waiting for remote cleanup.',
      step: 2,
      totalSteps: 2,
      host: 'parent.example.com',
    });
    monitor.close();
  });

  it('returns only its transaction-correlated inventory without credentials', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const xapi = {
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return vi.fn();
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const monitor = new ParentAdministrationMonitor(xapi, 'installer-inventory:one');
    const pending = monitor.waitForInventory(1_000);

    listener?.({
      Message: JSON.stringify({
        Message: INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE,
        TransactionId: 'installer-inventory:other',
        RegisteredParents: [],
        PendingDeregistrations: [],
      }),
    });
    listener?.({
      Message: JSON.stringify({
        Message: INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE,
        TransactionId: 'installer-inventory:one',
        RegisteredParents: [{
          Serial: 'PARENT123',
          Name: 'Training Room',
          Host: 'parent.example.com',
          Active: true,
        }],
        PendingDeregistrations: [],
      }),
    });

    await expect(pending).resolves.toEqual({
      registered: [{
        serial: 'PARENT123',
        name: 'Training Room',
        host: 'parent.example.com',
        active: true,
      }],
      pending: [],
    });
    monitor.close();
  });

  it('reports Pending Deregistration as a terminal browser outcome', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const xapi = {
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return vi.fn();
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const monitor = new ParentAdministrationMonitor(xapi, 'installer-deregistration:one');
    const pending = monitor.waitForDeregistration(1_000);

    listener?.({
      Message: JSON.stringify({
        Message: INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE,
        TransactionId: 'installer-deregistration:one',
        Detail: 'Remote cleanup remains pending.',
      }),
    });

    await expect(pending).resolves.toEqual({
      kind: 'pending',
      detail: 'Remote cleanup remains pending.',
    });
    monitor.close();
  });
});

describe('Parent Room deregistration operation lifecycle', () => {
  it('handles a terminal result during the initial wait and closes the monitor', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const stopFeedback = vi.fn();
    const command = vi.fn().mockResolvedValue(undefined);
    const xapi = {
      command,
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return stopFeedback;
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const request = {
      transactionId: 'installer-deregistration:initial',
      text: '{"request":"initial"}',
    };
    const operation = new ParentDeregistrationOperation(xapi, request);
    const result = operation.start(1_000);

    listener?.({
      Message: INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
      TransactionId: request.transactionId,
      Detail: 'Cleanup completed.',
    });

    await expect(result).resolves.toEqual({
      kind: 'completed',
      detail: 'Cleanup completed.',
    });
    expect(command).toHaveBeenCalledOnce();
    expect(xapi.event.on).toHaveBeenCalledOnce();
    expect(stopFeedback).toHaveBeenCalledOnce();
  });

  it('keeps the original transaction monitor after timeout and Keep Waiting does not resend or resubscribe', async () => {
    vi.useFakeTimers();
    try {
      let listener: ((event: unknown) => void) | undefined;
      const stopFeedback = vi.fn();
      const command = vi.fn().mockResolvedValue(undefined);
      const xapi = {
        command,
        event: {
          on: vi.fn((_path: string, callback: (event: unknown) => void) => {
            listener = callback;
            return stopFeedback;
          }),
        },
      } as unknown as CompanionDeviceXapi;
      const request = {
        transactionId: 'installer-deregistration:late',
        text: '{"request":"late"}',
      };
      const operation = new ParentDeregistrationOperation(xapi, request);
      const initialWait = operation.start(10);

      await vi.advanceTimersByTimeAsync(10);
      await expect(initialWait).resolves.toMatchObject({ kind: 'timeout' });
      expect(stopFeedback).not.toHaveBeenCalled();

      const continuedWait = operation.wait(1_000);
      listener?.({
        Message: INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
        TransactionId: request.transactionId,
        Detail: 'Late cleanup completed.',
      });

      await expect(continuedWait).resolves.toEqual({
        kind: 'completed',
        detail: 'Late cleanup completed.',
      });
      expect(command).toHaveBeenCalledOnce();
      expect(xapi.event.on).toHaveBeenCalledOnce();
      expect(stopFeedback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE, 'pending'],
    [INSTALLER_PARENT_DEREGISTRATION_FAILURE_MESSAGE, 'failed'],
  ] as const)('treats %s as terminal and closes the monitor', async (message, kind) => {
    let listener: ((event: unknown) => void) | undefined;
    const stopFeedback = vi.fn();
    const xapi = {
      command: vi.fn().mockResolvedValue(undefined),
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return stopFeedback;
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const request = {
      transactionId: `installer-deregistration:${kind}`,
      text: `{"request":"${kind}"}`,
    };
    const operation = new ParentDeregistrationOperation(xapi, request);
    const result = operation.start(1_000);

    listener?.({
      Message: message,
      TransactionId: request.transactionId,
      Detail: `${kind} detail`,
    });

    await expect(result).resolves.toMatchObject({ kind });
    expect(stopFeedback).toHaveBeenCalledOnce();
  });

  it('cancellation closes the subscription and a new operation cannot consume the stale result', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const stops = [vi.fn(), vi.fn()];
    const xapi = {
      command: vi.fn().mockResolvedValue(undefined),
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listeners.push(callback);
          return stops[listeners.length - 1];
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const first = new ParentDeregistrationOperation(xapi, {
      transactionId: 'installer-deregistration:first',
      text: '{"request":"first"}',
    });
    first.close();
    const second = new ParentDeregistrationOperation(xapi, {
      transactionId: 'installer-deregistration:second',
      text: '{"request":"second"}',
    });
    const result = second.start(1_000);

    listeners[0]?.({
      Message: INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
      TransactionId: 'installer-deregistration:first',
    });
    listeners[1]?.({
      Message: INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
      TransactionId: 'installer-deregistration:second',
      Detail: 'Second completed.',
    });

    await expect(result).resolves.toMatchObject({
      kind: 'completed',
      detail: 'Second completed.',
    });
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).toHaveBeenCalledOnce();
  });
});
