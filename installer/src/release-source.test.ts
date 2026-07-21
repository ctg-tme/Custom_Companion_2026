import { describe, expect, it, vi } from 'vitest';
import { discoverReleaseSources } from './release-source';

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
});
