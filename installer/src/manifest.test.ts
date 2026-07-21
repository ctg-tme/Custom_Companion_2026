import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  compareRoomOsVersions,
  isDeskSeries,
  isProductSupported,
  validateManifest,
} from './manifest';

describe('release manifest', () => {
  it('accepts the current root manifest', async () => {
    const value = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const manifest = validateManifest(value);
    expect(manifest.Files).toContain('Custom-Campanion_1_Main_2026.js');
    expect(manifest.Files).toContain('Custom-Campanion_2_Config_2026.js');
    expect(manifest.Files).toContain('Custom-Campanion_14_PinMode_2026.js');
    expect(manifest.MinimumRoomOSVersion).toBe('11.32.1.1');
  });

  it('lists every deployable root macro exactly once', async () => {
    const value = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
    const manifest = validateManifest(value);
    const rootEntries = await readdir(new URL('../../', import.meta.url), { withFileTypes: true });
    const deployableFiles = rootEntries
      .filter((entry) => entry.isFile() && /^Custom-Campanion_[A-Za-z0-9_-]+_2026\.js$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    expect([...manifest.Files].sort()).toEqual(deployableFiles);
  });

  it('rejects missing stable anchors and unsafe files', () => {
    expect(() => validateManifest({
      SchemaVersion: 1,
      Files: ['../macro.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    })).toThrow(/unsafe|unsupported/i);
  });
});

describe('device compatibility', () => {
  it('compares four-part RoomOS versions numerically', () => {
    expect(compareRoomOsVersions('RoomOS 11.32.1.2', '11.32.1.1')).toBe(1);
    expect(compareRoomOsVersions('11.32.1.1', '11.32.1.1')).toBe(0);
    expect(compareRoomOsVersions('11.31.9.9', '11.32.1.1')).toBe(-1);
  });

  it('normalizes Cisco product platform formatting and display sizes', () => {
    expect(isProductSupported('Cisco BoardPro75G2', ['Board Pro G2'])).toBe(true);
    expect(isProductSupported('DeskProG2', ['Desk Pro G2'])).toBe(true);
    expect(isProductSupported('Room Bar Pro', ['Board Pro'])).toBe(false);
    expect(isDeskSeries('Cisco DeskMini')).toBe(true);
  });
});
