import type { BoardXapi } from './device';
import {
  CONFIG_MACRO_FILE,
  GENERATED_STORAGE_MACRO,
  INITIALIZATION_STOPPED_MESSAGE,
  INITIALIZATION_SUCCESS_MESSAGE,
  MAIN_MACRO_FILE,
  PROJECT_MACRO_PATTERN,
  type InitializationOutcome,
  type InstallResource,
  type InstalledMacro,
} from './types';

export function legacyMacros(installed: InstalledMacro[], resources: InstallResource[]): InstalledMacro[] {
  const selected = new Set(resources.map((resource) => resource.macroName));
  return installed.filter(
    (macro) =>
      macro.name !== GENERATED_STORAGE_MACRO &&
      PROJECT_MACRO_PATTERN.test(macro.name) &&
      !selected.has(macro.name),
  );
}

export type LogClassification = 'success' | 'fatal' | 'warning' | 'info';

export function classifyMacroLog(event: unknown): { classification: LogClassification; message: string } {
  const message = typeof event === 'string' ? event : JSON.stringify(event);
  const normalized = message.toLowerCase();
  if (message.includes(INITIALIZATION_SUCCESS_MESSAGE)) return { classification: 'success', message };
  if (
    message.includes(INITIALIZATION_STOPPED_MESSAGE) ||
    /javascript.{0,40}(error|exception)/i.test(message) ||
    /(syntaxerror|referenceerror|typeerror):/i.test(message)
  ) {
    return { classification: 'fatal', message };
  }
  if (/"level"\s*:\s*"error"/i.test(message) || /(^|\W)error(\W|$)/i.test(normalized)) {
    return { classification: 'warning', message };
  }
  return { classification: 'info', message };
}

function macroNameFromLog(event: unknown): string | undefined {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  const record = event as Record<string, unknown>;
  const name = record.MacroName ?? record.Macro ?? record.Name;
  return typeof name === 'string' ? name : undefined;
}

export class InitializationMonitor {
  private readonly warnings: string[] = [];
  private failure?: string;
  private succeeded = false;
  private waiters = new Set<() => void>();
  private readonly stopFeedback: () => void;

  constructor(
    xapi: BoardXapi,
    onLog: (classification: LogClassification, message: string) => void,
    relevantMacroNames: ReadonlySet<string> = new Set(),
  ) {
    this.stopFeedback = xapi.event.on('Macros Log', (event: unknown) => {
      const macroName = macroNameFromLog(event);
      if (macroName && relevantMacroNames.size > 0 && !relevantMacroNames.has(macroName)) return;
      const result = classifyMacroLog(event);
      onLog(result.classification, result.message);
      if (result.classification === 'warning') this.warnings.push(result.message);
      if (result.classification === 'fatal') this.failure = result.message;
      if (result.classification === 'success') this.succeeded = true;
      if (this.failure || this.succeeded) {
        for (const wake of this.waiters) wake();
      }
    });
  }

  async wait(timeoutMs = 120_000): Promise<InitializationOutcome> {
    if (!this.failure && !this.succeeded) {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = window.setTimeout(() => {
          this.waiters.delete(wake);
          resolve();
        }, timeoutMs);
        this.waiters.add(wake);
      });
    }
    if (this.failure) return { kind: 'failed', warnings: [...this.warnings], failure: this.failure };
    if (this.succeeded) return { kind: this.warnings.length ? 'ready-with-warnings' : 'ready', warnings: [...this.warnings] };
    return { kind: 'timeout', warnings: [...this.warnings] };
  }

  close(): void {
    this.stopFeedback();
  }
}

function fileNameToMacro(fileName: string): string {
  return fileName.replace(/\.js$/, '');
}

function orderedResources(resources: InstallResource[]): InstallResource[] {
  const configMacro = fileNameToMacro(CONFIG_MACRO_FILE);
  const mainMacro = fileNameToMacro(MAIN_MACRO_FILE);
  return [...resources].sort((left, right) => {
    const rank = (resource: InstallResource) => {
      if (resource.macroName === mainMacro) return 3;
      if (resource.macroName === configMacro) return 2;
      if (resource.kind === 'external') return 0;
      return 1;
    };
    return rank(left) - rank(right);
  });
}

export async function installResources(
  xapi: BoardXapi,
  resources: InstallResource[],
  legacy: InstalledMacro[],
  purgeLegacy: boolean,
  onProgress: (message: string) => void,
): Promise<void> {
  const mainMacro = fileNameToMacro(MAIN_MACRO_FILE);
  const macrosToDeactivate = new Set([...resources.map((resource) => resource.macroName), ...legacy.map((macro) => macro.name)]);

  for (const name of macrosToDeactivate) {
    try {
      await xapi.command('Macros Macro Deactivate', { Name: name });
    } catch {
      // A macro may not exist yet or may already be inactive. Save remains authoritative.
    }
  }

  if (purgeLegacy) {
    for (const macro of legacy) {
      onProgress(`Removing legacy macro ${macro.name}`);
      await xapi.command('Macros Macro Remove', { Name: macro.name });
    }
  }

  for (const resource of orderedResources(resources)) {
    onProgress(`Saving ${resource.macroName}`);
    await xapi.command(
      'Macros Macro Save',
      { Name: resource.macroName, Overwrite: 'True', Transpile: 'True' },
      resource.content,
    );
  }

  onProgress(`Activating ${mainMacro}`);
  await xapi.command('Macros Macro Activate', { Name: mainMacro });
}
