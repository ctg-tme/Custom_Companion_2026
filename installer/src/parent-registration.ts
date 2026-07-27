import { normalizeCompanionDeviceHost, normalizeSerial, type CompanionDeviceXapi } from './device';
import {
  INSTALLER_PARENT_REGISTRATION_ACTION,
  INSTALLER_PARENT_REGISTRATION_FAILURE_MESSAGE,
  INSTALLER_PARENT_REGISTRATION_PROGRESS_MESSAGE,
  INSTALLER_PARENT_REGISTRATION_SUCCESS_MESSAGE,
  type ParentRegistrationForm,
  type ParentRegistrationOutcome,
  type ParentRegistrationRequest,
  type ParentWorkflowProgress,
} from './types';

type LogPayload = Record<string, unknown>;

function randomSuffix(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function parentHost(input: string): string {
  try {
    return normalizeCompanionDeviceHost(input);
  } catch {
    throw new Error('Enter a valid Parent Room Device hostname or IP address.');
  }
}

export function createParentRegistrationRequest(
  form: ParentRegistrationForm,
  companionSerial: string,
): ParentRegistrationRequest {
  const host = parentHost(form.host);
  const serial = normalizeSerial(form.serial);
  const companionDeviceSerial = normalizeSerial(companionSerial);
  const username = form.username.trim();

  if (!companionDeviceSerial) throw new Error('Reconnect to the verified Companion Device before registering a Parent Room Device.');
  if (!serial) throw new Error('Enter the expected Parent Room Device serial number.');
  if (!username) throw new Error('Enter the Parent Room Device username.');
  if (!form.password) throw new Error('Enter the Parent Room Device password.');
  if (form.password !== form.passwordConfirmation) throw new Error('The Parent Room Device passwords do not match.');

  const transactionId = `installer-registration:${Date.now()}:${randomSuffix()}`;
  return {
    transactionId,
    text: JSON.stringify({
      App: 'Companion Board 2026',
      Action: INSTALLER_PARENT_REGISTRATION_ACTION,
      Serial: companionDeviceSerial,
      Source: {
        Role: 'Installer',
        Name: 'Custom Companion Installer',
      },
      Payload: {
        TransactionId: transactionId,
        Parent: {
          Host: host,
          Serial: serial,
          Username: username,
          Password: form.password,
        },
        AllowOverwrite: form.allowOverwrite,
      },
    }),
  };
}

export async function sendParentRegistrationRequest(
  xapi: CompanionDeviceXapi,
  request: ParentRegistrationRequest,
): Promise<void> {
  await xapi.command('Message Send', { Text: request.text });
}

function serializedLog(event: unknown): string {
  return typeof event === 'string' ? event : JSON.stringify(event);
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
  const record = typeof event === 'string'
    ? parseJsonRecord(event)
    : event && typeof event === 'object' && !Array.isArray(event)
      ? event as LogPayload
      : undefined;
  if (!record) return undefined;
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

function numberField(record: LogPayload, field: string): number {
  const value = Number(record[field]);
  return Number.isFinite(value) ? value : 0;
}

export class ParentRegistrationMonitor {
  private outcome?: ParentRegistrationOutcome;
  private waiters = new Set<() => void>();
  private readonly stopFeedback: () => void;

  constructor(
    xapi: CompanionDeviceXapi,
    private readonly transactionId: string,
    private readonly onLog: (message: string) => void,
    private readonly onProgress: (progress: ParentWorkflowProgress) => void = () => undefined,
  ) {
    this.stopFeedback = xapi.event.on('Macros Log', (event: unknown) => {
      const payload = logPayload(event);
      if (!payload || payload.TransactionId !== this.transactionId) return;
      const message = serializedLog(event);
      this.onLog(message);
      if (payload.Message === INSTALLER_PARENT_REGISTRATION_PROGRESS_MESSAGE) {
        this.onProgress({
          stage: stringField(payload, 'Stage'),
          detail: stringField(payload, 'Detail'),
          step: numberField(payload, 'Step'),
          totalSteps: numberField(payload, 'TotalSteps'),
          host: stringField(payload, 'Host'),
        });
      } else if (payload.Message === INSTALLER_PARENT_REGISTRATION_SUCCESS_MESSAGE) {
        this.outcome = {
          kind: 'succeeded',
          detail: stringField(payload, 'Detail'),
          host: stringField(payload, 'Host'),
          stage: stringField(payload, 'Stage'),
          code: stringField(payload, 'Code'),
        };
      } else if (payload.Message === INSTALLER_PARENT_REGISTRATION_FAILURE_MESSAGE) {
        this.outcome = {
          kind: 'failed',
          detail: stringField(payload, 'Detail'),
          host: stringField(payload, 'Host'),
          stage: stringField(payload, 'Stage'),
          code: stringField(payload, 'Code'),
        };
      }
      if (this.outcome) {
        for (const wake of this.waiters) wake();
      }
    });
  }

  async wait(timeoutMs = 300_000): Promise<ParentRegistrationOutcome> {
    if (!this.outcome) {
      await new Promise<void>((resolve) => {
        const wake = () => {
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
    return this.outcome ?? { kind: 'timeout' };
  }

  close(): void {
    this.stopFeedback();
  }
}
