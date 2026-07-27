import { describe, expect, it, vi } from 'vitest';
import type { CompanionDeviceXapi } from './device';
import {
  ParentAdministrationMonitor,
  createParentDeregistrationRequest,
  createParentInventoryRequest,
  parentInventoryPlanAfterInstallation,
  sendParentAdministrationRequest,
} from './parent-administration';
import {
  INSTALLER_PARENT_DEREGISTRATION_ACTION,
  INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE,
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
