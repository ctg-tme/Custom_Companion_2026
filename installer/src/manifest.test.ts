import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  compareRoomOsVersions,
  completeSetupCapabilities,
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
    expect(manifest.CompanionInstaller).toEqual({
      ContractVersion: 1,
      TestedVersion: '0.1.19',
      Capabilities: [
        'installer.parent-deregistration.v1',
        'installer.parent-inventory.v1',
        'installer.parent-registration.v1',
      ],
    });
    expect(completeSetupCapabilities(manifest)).toEqual({
      parentRegistration: true,
      parentInventory: true,
      parentDeregistration: true,
    });
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
      CompanionInstaller: {
        ContractVersion: 1,
        TestedVersion: '0.1.18',
        Capabilities: [],
      },
      Files: ['../macro.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    })).toThrow(/unsafe|unsupported/i);
  });

  it('rejects metadata-free and unsupported installer contracts', () => {
    const base = {
      SchemaVersion: 1,
      Files: ['Custom-Campanion_1_Main_2026.js', 'Custom-Campanion_2_Config_2026.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    };
    expect(() => validateManifest(base)).toThrow(/compatibility metadata is required/i);
    expect(() => validateManifest({
      ...base,
      CompanionInstaller: {
        ContractVersion: 2,
        TestedVersion: '0.1.18',
        Capabilities: [],
      },
    })).toThrow(/Contract Version 2 is not supported/i);
  });

  it('rejects duplicate or unsorted Installer Capabilities', () => {
    const base = {
      SchemaVersion: 1,
      Files: ['Custom-Campanion_1_Main_2026.js', 'Custom-Campanion_2_Config_2026.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    };
    expect(() => validateManifest({
      ...base,
      CompanionInstaller: {
        ContractVersion: 1,
        TestedVersion: '0.1.18',
        Capabilities: [
          'installer.parent-registration.v1',
          'installer.parent-registration.v1',
        ],
      },
    })).toThrow(/duplicate/i);
    expect(() => validateManifest({
      ...base,
      CompanionInstaller: {
        ContractVersion: 1,
        TestedVersion: '0.1.18',
        Capabilities: [
          'installer.parent-registration.v1',
          'installer.parent-inventory.v1',
        ],
      },
    })).toThrow(/sorted/i);
  });

  it('requires Inventory when Deregistration is declared', () => {
    expect(() => validateManifest({
      SchemaVersion: 1,
      CompanionInstaller: {
        ContractVersion: 1,
        TestedVersion: '0.1.18',
        Capabilities: ['installer.parent-deregistration.v1'],
      },
      Files: ['Custom-Campanion_1_Main_2026.js', 'Custom-Campanion_2_Config_2026.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    })).toThrow(/requires Installer Capabilities: installer\.parent-inventory\.v1/i);
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
