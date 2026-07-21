import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  configPathId,
  formatConfigPath,
  parseConfigDocument,
  patchConfigSource,
  setLockedInstallerValues,
} from './config-editor';
import type { ConfigValue } from './types';

describe('dynamic Config editing', () => {
  it('discovers every literal leaf in the current Config macro', async () => {
    const source = await readFile(new URL('../../Custom-Campanion_2_Config_2026.js', import.meta.url), 'utf8');
    const document = parseConfigDocument(source);
    expect(document.leaves.some((leaf) => formatConfigPath(leaf.path) === 'UserInterface.WebWidget.CompanionWidget.weather.latitude')).toBe(true);
    expect(document.leaves.find((leaf) => formatConfigPath(leaf.path) === 'version')?.lockedReason).toBe('version');
  });

  it('injects the login host and callback values without reformatting the file', async () => {
    const source = await readFile(new URL('../../Custom-Campanion_2_Config_2026.js', import.meta.url), 'utf8');
    const document = parseConfigDocument(source);
    let values = new Map<string, ConfigValue>(document.leaves.map((leaf) => [configPathId(leaf.path), leaf.value]));
    values = setLockedInstallerValues(document, values, 'board.lab.example');
    for (const leaf of document.leaves) {
      const path = formatConfigPath(leaf.path);
      if (path === 'CompanionBoardInformation.username') values.set(configPathId(leaf.path), 'custom-companion');
      if (path === 'CompanionBoardInformation.password') values.set(configPathId(leaf.path), 'temporary-test-value');
    }
    const patched = patchConfigSource(document, values);
    expect(patched).toContain('host: "board.lab.example"');
    expect(patched).toContain('username: "custom-companion"');
    expect(patched).toContain("temperatureUnit: 'fahrenheit'");
    expect(patched).toContain('// Deferred Surface:');
    expect(source).not.toContain('temporary-test-value');
  });

  it('does not allow the version to be changed', () => {
    const document = parseConfigDocument("const config = { version: '1.0.0.0' }; export { config };");
    const values = new Map<string, ConfigValue>([[configPathId(['version']), '2.0.0.0']]);
    expect(() => patchConfigSource(document, values)).toThrow(/cannot be edited/i);
  });
});
