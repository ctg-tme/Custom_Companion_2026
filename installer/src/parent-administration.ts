import { normalizeSerial, type CompanionDeviceXapi } from './device';
import {
  INSTALLER_PARENT_DEREGISTRATION_ACTION,
  INSTALLER_PARENT_DEREGISTRATION_FAILURE_MESSAGE,
  INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE,
  INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
  INSTALLER_PARENT_INVENTORY_ACTION,
  INSTALLER_PARENT_INVENTORY_FAILURE_MESSAGE,
  INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE,
  type InstallationType,
  type ParentAdministrationRequest,
  type ParentDeregistrationOutcome,
  type ParentInventory,
  type PendingDeregistrationSummary,
  type RegisteredParentSummary,
} from './types';

type LogPayload = Record<string, unknown>;

export function parentInventoryPlanAfterInstallation(
  installationType: InstallationType | undefined,
): { inventory: ParentInventory; shouldRequest: boolean } {
  return {
    inventory: { registered: [], pending: [] },
    shouldRequest: installationType !== 'fresh',
  };
}

function randomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function transactionId(kind: 'inventory' | 'deregistration'): string {
  return `installer-${kind}:${Date.now()}:${randomSuffix()}`;
}

function requestEnvelope(
  action: string,
  companionSerial: string,
  requestTransactionId: string,
  payload: Record<string, unknown> = {},
): ParentAdministrationRequest {
  const serial = normalizeSerial(companionSerial);
  if (!serial) throw new Error('Reconnect to the verified Companion Device before managing Parent Room Devices.');
  return {
    transactionId: requestTransactionId,
    text: JSON.stringify({
      App: 'Companion Board 2026',
      Action: action,
      Serial: serial,
      Source: {
        Role: 'Installer',
        Name: 'Custom Companion Installer',
      },
      Payload: {
        TransactionId: requestTransactionId,
        ...payload,
      },
    }),
  };
}

export function createParentInventoryRequest(companionSerial: string): ParentAdministrationRequest {
  const requestTransactionId = transactionId('inventory');
  return requestEnvelope(
    INSTALLER_PARENT_INVENTORY_ACTION,
    companionSerial,
    requestTransactionId,
  );
}

export function createParentDeregistrationRequest(
  companionSerial: string,
  parentSerial: string,
): ParentAdministrationRequest {
  const normalizedParentSerial = normalizeSerial(parentSerial);
  if (!normalizedParentSerial) throw new Error('Select a valid Parent Room Registration to remove.');
  const requestTransactionId = transactionId('deregistration');
  return requestEnvelope(
    INSTALLER_PARENT_DEREGISTRATION_ACTION,
    companionSerial,
    requestTransactionId,
    { ParentSerial: normalizedParentSerial },
  );
}

export async function sendParentAdministrationRequest(
  xapi: CompanionDeviceXapi,
  request: ParentAdministrationRequest,
): Promise<void> {
  await xapi.command('Message Send', { Text: request.text });
}

function parseJsonRecord(text: string): LogPayload | undefined {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return undefined;
  try {
    const value = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as LogPayload
      : undefined;
  } catch {
    return undefined;
  }
}

function logPayload(event: unknown): LogPayload | undefined {
  if (typeof event === 'string') return parseJsonRecord(event);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  const record = event as LogPayload;
  if (typeof record.TransactionId === 'string' && typeof record.Message === 'string') return record;
  for (const key of ['Message', 'Text']) {
    if (typeof record[key] === 'string') {
      const parsed = parseJsonRecord(record[key]);
      if (parsed) return parsed;
    }
  }
  return undefined;
}

function stringField(record: LogPayload, field: string): string {
  return typeof record[field] === 'string' ? record[field] : '';
}

function registeredParents(value: unknown): RegisteredParentSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as LogPayload;
    const serial = normalizeSerial(stringField(record, 'Serial'));
    const host = stringField(record, 'Host');
    if (!serial || !host) return [];
    return [{
      serial,
      name: stringField(record, 'Name') || host,
      host,
      active: record.Active === true,
    }];
  });
}

function pendingDeregistrations(value: unknown): PendingDeregistrationSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as LogPayload;
    const serial = normalizeSerial(stringField(record, 'Serial'));
    const host = stringField(record, 'Host');
    if (!serial || !host) return [];
    return [{
      serial,
      name: stringField(record, 'Name') || host,
      host,
      createdAt: stringField(record, 'CreatedAt'),
    }];
  });
}

export class ParentAdministrationMonitor {
  private payload?: LogPayload;
  private waiters = new Set<() => void>();
  private readonly stopFeedback: () => void;

  constructor(
    xapi: CompanionDeviceXapi,
    private readonly transactionId: string,
  ) {
    this.stopFeedback = xapi.event.on('Macros Log', (event: unknown) => {
      const payload = logPayload(event);
      if (!payload || payload.TransactionId !== this.transactionId) return;
      this.payload = payload;
      for (const wake of this.waiters) wake();
    });
  }

  private async waitForMessages(messages: ReadonlySet<string>, timeoutMs: number): Promise<LogPayload | undefined> {
    if (!this.payload || !messages.has(stringField(this.payload, 'Message'))) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          if (!this.payload || !messages.has(stringField(this.payload, 'Message'))) return;
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = globalThis.setTimeout(() => {
          this.waiters.delete(wake);
          resolve();
        }, timeoutMs);
        this.waiters.add(wake);
      });
    }
    return this.payload && messages.has(stringField(this.payload, 'Message'))
      ? this.payload
      : undefined;
  }

  async waitForInventory(timeoutMs = 15_000): Promise<ParentInventory> {
    const payload = await this.waitForMessages(new Set([
      INSTALLER_PARENT_INVENTORY_SUCCESS_MESSAGE,
      INSTALLER_PARENT_INVENTORY_FAILURE_MESSAGE,
    ]), timeoutMs);
    if (!payload) throw new Error('The Companion Device did not return its Parent Room Registrations.');
    if (payload.Message === INSTALLER_PARENT_INVENTORY_FAILURE_MESSAGE) {
      throw new Error(stringField(payload, 'Detail') || 'The Companion Device could not read its Parent Room Registrations.');
    }
    return {
      registered: registeredParents(payload.RegisteredParents),
      pending: pendingDeregistrations(payload.PendingDeregistrations),
    };
  }

  async waitForDeregistration(timeoutMs = 75_000): Promise<ParentDeregistrationOutcome> {
    const payload = await this.waitForMessages(new Set([
      INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE,
      INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE,
      INSTALLER_PARENT_DEREGISTRATION_FAILURE_MESSAGE,
    ]), timeoutMs);
    if (!payload) {
      return {
        kind: 'timeout',
        detail: 'The Companion Device did not return a Parent Room Deregistration result.',
      };
    }
    const detail = stringField(payload, 'Detail');
    if (payload.Message === INSTALLER_PARENT_DEREGISTRATION_SUCCESS_MESSAGE) {
      return { kind: 'completed', detail };
    }
    if (payload.Message === INSTALLER_PARENT_DEREGISTRATION_PENDING_MESSAGE) {
      return { kind: 'pending', detail };
    }
    return {
      kind: 'failed',
      detail: detail || 'The Companion Device could not deregister the Parent Room Device.',
    };
  }

  close(): void {
    this.stopFeedback();
    this.waiters.clear();
  }
}
