import { describe, expect, it } from 'vitest';
import { classifyMacroLog, legacyMacros } from './install';
import { INITIALIZATION_STOPPED_MESSAGE, INITIALIZATION_SUCCESS_MESSAGE } from './types';

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
