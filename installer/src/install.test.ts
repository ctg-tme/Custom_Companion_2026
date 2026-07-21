import { describe, expect, it, vi } from 'vitest';
import type { BoardXapi } from './device';
import { classifyMacroLog, installResources, legacyMacros } from './install';
import {
  GENERATED_STORAGE_MACRO,
  INITIALIZATION_STOPPED_MESSAGE,
  INITIALIZATION_SUCCESS_MESSAGE,
  MAIN_MACRO_FILE,
  type InstallResource,
} from './types';

describe('legacy macro scope', () => {
  it('finds only old project macros and excludes generated storage', () => {
    const legacy = legacyMacros(
      [
        { name: 'Custom-Campanion_1_Main_2026', active: true },
        { name: 'Custom-Campanion_14_Legacy_2026', active: true },
        { name: 'Custom-Campanion-Storage', active: true },
        { name: 'Unrelated-Macro', active: true },
      ],
      [{ macroName: 'Custom-Campanion_1_Main_2026', fileName: 'Custom-Campanion_1_Main_2026.js', content: '', kind: 'project' }],
    );
    expect(legacy.map((macro) => macro.name)).toEqual(['Custom-Campanion_14_Legacy_2026']);
  });
});

describe('installation type', () => {
  const mainResource: InstallResource = {
    macroName: MAIN_MACRO_FILE.replace(/\.js$/, ''),
    fileName: MAIN_MACRO_FILE,
    content: '// main source',
    kind: 'project',
  };

  it('removes only generated storage before saving resources for a clean installation', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const progress: string[] = [];
    const xapi = { command } as unknown as BoardXapi;

    await installResources(
      xapi,
      [mainResource],
      [
        { name: GENERATED_STORAGE_MACRO, active: false },
        { name: 'Unrelated-Macro', active: true },
      ],
      { purgeLegacy: false, purgeGeneratedStorage: true },
      (message) => progress.push(message),
    );

    const calls = command.mock.calls.map(([path, parameters]) => ({ path, parameters }));
    const storageRemoval = calls.findIndex(
      (call) => call.path === 'Macros Macro Remove' && call.parameters?.Name === GENERATED_STORAGE_MACRO,
    );
    const firstSave = calls.findIndex((call) => call.path === 'Macros Macro Save');

    expect(storageRemoval).toBeGreaterThanOrEqual(0);
    expect(storageRemoval).toBeLessThan(firstSave);
    expect(calls).not.toContainEqual({ path: 'Macros Macro Remove', parameters: { Name: 'Unrelated-Macro' } });
    expect(progress[0]).toBe(`Removing generated storage macro ${GENERATED_STORAGE_MACRO}`);
  });

  it('preserves generated storage during a standard installation', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const xapi = { command } as unknown as BoardXapi;

    await installResources(
      xapi,
      [mainResource],
      [{ name: GENERATED_STORAGE_MACRO, active: false }],
      { purgeLegacy: false, purgeGeneratedStorage: false },
      () => undefined,
    );

    expect(command.mock.calls).not.toContainEqual([
      'Macros Macro Remove',
      { Name: GENERATED_STORAGE_MACRO },
    ]);
  });

  it('continues a clean installation without a remove command when generated storage is absent', async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const xapi = { command } as unknown as BoardXapi;

    await installResources(
      xapi,
      [mainResource],
      [],
      { purgeLegacy: false, purgeGeneratedStorage: true },
      () => undefined,
    );

    expect(command.mock.calls.some(([path]) => path === 'Macros Macro Save')).toBe(true);
    expect(command.mock.calls.some(([path]) => path === 'Macros Macro Remove')).toBe(false);
  });
});

describe('macro log classification', () => {
  it('recognizes the exact initialization success message', () => {
    expect(classifyMacroLog({ Message: INITIALIZATION_SUCCESS_MESSAGE }).classification).toBe('success');
  });

  it('treats stopped initialization and JavaScript runtime errors as fatal', () => {
    expect(classifyMacroLog({ Message: INITIALIZATION_STOPPED_MESSAGE }).classification).toBe('fatal');
    expect(classifyMacroLog({ Message: 'JavaScript error: ReferenceError: missing is not defined' }).classification).toBe('fatal');
  });

  it('retains other errors as warnings so success can complete with warnings', () => {
    expect(classifyMacroLog({ Level: 'Error', Message: 'Optional weather request failed' }).classification).toBe('warning');
  });
});
