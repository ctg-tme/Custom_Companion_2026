import { describe, expect, it, vi } from 'vitest';
import type { CompanionDeviceXapi } from './device';
import {
  ParentRegistrationMonitor,
  createParentRegistrationRequest,
  sendParentRegistrationRequest,
} from './parent-registration';
import {
  INSTALLER_PARENT_REGISTRATION_ACTION,
  INSTALLER_PARENT_REGISTRATION_FAILURE_MESSAGE,
  INSTALLER_PARENT_REGISTRATION_SUCCESS_MESSAGE,
} from './types';

describe('installer Parent Room Registration request', () => {
  it('sends an authenticated Companion Device message with a transaction-correlated parent payload', async () => {
    const request = createParentRegistrationRequest({
      host: 'https://Parent.Example.com',
      serial: 'parent-123',
      username: 'parent-admin',
      password: 'test-password',
      passwordConfirmation: 'test-password',
      allowOverwrite: false,
    }, 'companion-456');
    const command = vi.fn().mockResolvedValue(undefined);

    await sendParentRegistrationRequest({ command } as unknown as CompanionDeviceXapi, request);

    const payload = JSON.parse(request.text) as Record<string, unknown>;
    expect(payload).toMatchObject({
      App: 'Companion Board 2026',
      Action: INSTALLER_PARENT_REGISTRATION_ACTION,
      Serial: 'COMPANION456',
      Source: { Role: 'Installer', Name: 'Custom Companion Installer' },
      Payload: {
        TransactionId: request.transactionId,
        Parent: { Host: 'parent.example.com', Serial: 'PARENT123', Username: 'parent-admin', Password: 'test-password' },
        AllowOverwrite: false,
      },
    });
    expect(command).toHaveBeenCalledWith('Message Send', { Text: request.text });
  });

  it('requires matching passwords before any Companion Device message is created', () => {
    expect(() => createParentRegistrationRequest({
      host: 'parent.example.com',
      serial: 'parent-123',
      username: 'parent-admin',
      password: 'one',
      passwordConfirmation: 'two',
      allowOverwrite: false,
    }, 'companion-456')).toThrow('passwords do not match');
  });

  it('rejects the unset host placeholder before any Companion Device message is created', () => {
    expect(() => createParentRegistrationRequest({
      host: '0.0.0.0',
      serial: 'parent-123',
      username: 'parent-admin',
      password: 'test-password',
      passwordConfirmation: 'test-password',
      allowOverwrite: false,
    }, 'companion-456')).toThrow('valid Parent Room Device hostname or IP address');
  });
});

describe('Parent Room Registration monitor', () => {
  it('accepts only the terminal result for its own transaction', async () => {
    let listener: ((event: unknown) => void) | undefined;
    const stopFeedback = vi.fn();
    const xapi = {
      event: {
        on: vi.fn((_path: string, callback: (event: unknown) => void) => {
          listener = callback;
          return stopFeedback;
        }),
      },
    } as unknown as CompanionDeviceXapi;
    const monitor = new ParentRegistrationMonitor(xapi, 'installer-registration:one', () => undefined);
    const pending = monitor.wait(1_000);

    listener?.({ Message: INSTALLER_PARENT_REGISTRATION_SUCCESS_MESSAGE, TransactionId: 'installer-registration:other' });
    listener?.({ Message: INSTALLER_PARENT_REGISTRATION_FAILURE_MESSAGE, TransactionId: 'installer-registration:one' });

    await expect(pending).resolves.toMatchObject({ kind: 'failed' });
    monitor.close();
    expect(stopFeedback).toHaveBeenCalledOnce();
  });
});
