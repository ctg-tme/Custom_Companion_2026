import { describe, expect, it, vi } from 'vitest';
import { completeSetupCapabilities, validateManifest } from './manifest';
import {
  applyLegacyInstallerCompatibility,
  discoverReleaseSources,
  loadSourceSnapshot,
} from './release-source';
import type { ReleaseSource } from './types';

describe('release discovery', () => {
  it('orders stable releases, Preview releases, then Main Beta', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/main/snapshot.json')) {
        return new Response(JSON.stringify({ version: '0.1.2.26' }), { status: 200 });
      }
      return new Response(JSON.stringify([
        { id: 1, tag_name: 'v1.0.0', name: '1.0.0', draft: false, prerelease: false, published_at: '2026-06-01T00:00:00Z' },
        { id: 2, tag_name: 'v2.0.0-preview.1', name: '2.0 Preview 1', draft: false, prerelease: true, published_at: '2026-07-01T00:00:00Z' },
        { id: 3, tag_name: 'v1.1.0', name: '1.1.0', draft: false, prerelease: false, published_at: '2026-06-20T00:00:00Z' },
        { id: 4, tag_name: 'draft', name: 'Draft', draft: true, prerelease: false, published_at: '2026-07-20T00:00:00Z' },
      ]), { status: 200 });
    }) as unknown as typeof fetch;
    const discovery = await discoverReleaseSources(fetcher);
    expect(discovery.sources.map((source) => source.label)).toEqual(['1.1.0', '1.0.0', '2.0 Preview 1 (Preview)', 'Main Fork — 0.1.2.26 (Beta)']);
    expect(discovery.defaultSourceId).toBe('release-3');
    expect(discovery.sources[0]?.resourceUrl).toBe('https://github.com/ctg-tme/Custom_Companion_2026/releases/tag/v1.1.0');
    expect(discovery.sources.at(-1)?.resourceUrl).toBe('https://github.com/ctg-tme/Custom_Companion_2026/tree/main');
  });

  it('reports release discovery as unreachable but retains Main Beta', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/main/snapshot.json')
        ? new Response(JSON.stringify({ version: '0.1.2.26' }), { status: 200 })
        : new Response('', { status: 404 })) as unknown as typeof fetch;
    const discovery = await discoverReleaseSources(fetcher);
    expect(discovery.unreachableReason).toMatch(/private/i);
    expect(discovery.sources).toEqual([{
      id: 'main',
      label: 'Main Fork — 0.1.2.26 (Beta)',
      kind: 'main',
      resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/tree/main',
      version: '0.1.2.26',
    }]);
  });

  it('assigns only Parent Room Registration to the exact immutable legacy Preview', () => {
    const source: ReleaseSource = {
      id: 'release-legacy',
      label: 'v0.1.2.51 (Preview)',
      kind: 'preview',
      resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/releases/tag/v0.1.2.51',
      tagName: 'v0.1.2.51',
    };
    const legacyManifest = {
      SchemaVersion: 1,
      Files: ['Custom-Campanion_1_Main_2026.js', 'Custom-Campanion_2_Config_2026.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    };
    const manifest = validateManifest(applyLegacyInstallerCompatibility(
      legacyManifest,
      source,
      'be539c292d79197e8303d42b68902c6985cde699',
    ));

    expect(manifest.CompanionInstaller).toEqual({
      ContractVersion: 1,
      TestedVersion: '0.1.14',
      Capabilities: ['installer.parent-registration.v1'],
    });
    expect(completeSetupCapabilities(manifest)).toEqual({
      parentRegistration: true,
      parentInventory: false,
      parentDeregistration: false,
    });
  });

  it('refuses to apply the legacy profile if the published tag moves', () => {
    const source: ReleaseSource = {
      id: 'release-legacy',
      label: 'v0.1.2.51 (Preview)',
      kind: 'preview',
      resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/releases/tag/v0.1.2.51',
      tagName: 'v0.1.2.51',
    };
    expect(() => applyLegacyInstallerCompatibility(
      { SchemaVersion: 1 },
      source,
      '0000000000000000000000000000000000000000',
    )).toThrow(/expected immutable commit/i);
  });

  it('loads the legacy Preview with Registration only and rejects other metadata-free releases', async () => {
    const legacyManifest = {
      SchemaVersion: 1,
      Files: ['Custom-Campanion_1_Main_2026.js', 'Custom-Campanion_2_Config_2026.js'],
      MinimumRoomOSVersion: '11.32.1.1',
      SoftwarePlatform: ['roomos'],
      ProductPlatform: ['Board Pro'],
      ExternalDependencies: [],
    };
    const exactLegacySource: ReleaseSource = {
      id: 'release-legacy',
      label: 'v0.1.2.51 (Preview)',
      kind: 'preview',
      resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/releases/tag/v0.1.2.51',
      tagName: 'v0.1.2.51',
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits/')) {
        return new Response(JSON.stringify({
          sha: 'be539c292d79197e8303d42b68902c6985cde699',
        }), { status: 200 });
      }
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify(legacyManifest), { status: 200 });
      }
      return new Response('// legacy macro source', { status: 200 });
    }) as unknown as typeof fetch;

    const snapshot = await loadSourceSnapshot(exactLegacySource, fetcher);
    expect(completeSetupCapabilities(snapshot.manifest)).toEqual({
      parentRegistration: true,
      parentInventory: false,
      parentDeregistration: false,
    });

    await expect(loadSourceSnapshot({
      ...exactLegacySource,
      id: 'release-without-contract',
      label: 'v0.1.2.50 (Preview)',
      tagName: 'v0.1.2.50',
    }, fetcher)).rejects.toThrow(/compatibility metadata is required/i);
  });
});
