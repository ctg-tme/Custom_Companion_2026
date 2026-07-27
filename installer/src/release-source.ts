import { validateManifest } from './manifest';
import {
  COMPANION_INSTALLER_CONTRACT_VERSION,
  INSTALLER_PARENT_REGISTRATION_CAPABILITY,
  type InstallResource,
  type ReleaseDiscovery,
  type ReleaseSource,
  type SourceSnapshot,
} from './types';

const OWNER = 'ctg-tme';
const REPOSITORY = 'Custom_Companion_2026';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`;
const RAW_ROOT = `https://raw.githubusercontent.com/${OWNER}/${REPOSITORY}`;
const REPOSITORY_ROOT = `https://github.com/${OWNER}/${REPOSITORY}`;
const LEGACY_PREVIEW_TAG = 'v0.1.2.51';
const LEGACY_PREVIEW_COMMIT_SHA = 'be539c292d79197e8303d42b68902c6985cde699';

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseNextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === 'next') return match[1];
  }
  return undefined;
}

async function fetchAllReleases(fetcher: typeof fetch): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  let nextUrl: string | undefined = `${API_ROOT}/releases?per_page=100`;

  while (nextUrl) {
    const response = await fetcher(nextUrl, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      const suffix = response.status === 404 ? 'the repository may be private' : `HTTP ${response.status}`;
      throw new Error(`GitHub releases are unreachable (${suffix}).`);
    }
    const page = (await response.json()) as GitHubRelease[];
    releases.push(...page);
    nextUrl = parseNextLink(response.headers.get('link'));
  }
  return releases;
}

export async function discoverReleaseSources(fetcher: typeof fetch = fetch): Promise<ReleaseDiscovery> {
  const pageBaseUri = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
  let mainVersion: string | undefined;
  try {
    const metadata = (await fetchJson(new URL('./main/snapshot.json', pageBaseUri).href, 'Main Fork snapshot metadata', fetcher)) as { version?: unknown };
    if (typeof metadata.version === 'string' && metadata.version.trim()) mainVersion = metadata.version.trim();
  } catch {
    // Main remains usable; loadSourceSnapshot will report a blocking metadata error if selected.
  }
  const mainSource: ReleaseSource = {
    id: 'main',
    label: mainVersion ? `Main Fork — ${mainVersion} (Beta)` : 'Main Fork (Beta)',
    kind: 'main',
    resourceUrl: `${REPOSITORY_ROOT}/tree/main`,
    version: mainVersion,
  };
  try {
    const releases = (await fetchAllReleases(fetcher)).filter((release) => !release.draft);
    const descending = (left: GitHubRelease, right: GitHubRelease) =>
      Date.parse(right.published_at ?? '1970-01-01') - Date.parse(left.published_at ?? '1970-01-01');
    const stable = releases.filter((release) => !release.prerelease).sort(descending);
    const preview = releases.filter((release) => release.prerelease).sort(descending);
    const mapRelease = (release: GitHubRelease, kind: 'stable' | 'preview'): ReleaseSource => ({
      id: `release-${release.id}`,
      label: `${release.name || release.tag_name}${kind === 'preview' ? ' (Preview)' : ''}`,
      kind,
      resourceUrl: `${REPOSITORY_ROOT}/releases/tag/${encodeURIComponent(release.tag_name)}`,
      version: release.tag_name,
      tagName: release.tag_name,
      publishedAt: release.published_at ?? undefined,
    });
    const sources = [...stable.map((item) => mapRelease(item, 'stable')), ...preview.map((item) => mapRelease(item, 'preview')), mainSource];
    return { sources, defaultSourceId: sources[0]?.id ?? 'main' };
  } catch (error) {
    return {
      sources: [mainSource],
      defaultSourceId: 'main',
      unreachableReason: errorMessage(error),
    };
  }
}

async function fetchJson(url: string, label: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} is unavailable (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function fetchText(url: string, label: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} is unavailable (HTTP ${response.status}).`);
  return response.text();
}

async function resolveReleaseSha(tagName: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(`${API_ROOT}/commits/${encodeURIComponent(tagName)}`, {
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Unable to resolve release ${tagName} to a commit SHA (HTTP ${response.status}).`);
  const result = (await response.json()) as { sha?: unknown };
  if (typeof result.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.sha)) {
    throw new Error(`GitHub returned an invalid commit SHA for release ${tagName}.`);
  }
  return result.sha;
}

function macroName(fileName: string): string {
  return fileName.replace(/\.js$/, '');
}

export function applyLegacyInstallerCompatibility(
  value: unknown,
  source: ReleaseSource,
  commitSha: string,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.CompanionInstaller !== undefined || source.tagName !== LEGACY_PREVIEW_TAG) return value;
  if (commitSha !== LEGACY_PREVIEW_COMMIT_SHA) {
    throw new Error(`${LEGACY_PREVIEW_TAG} no longer resolves to its expected immutable commit.`);
  }
  return {
    ...candidate,
    CompanionInstaller: {
      ContractVersion: COMPANION_INSTALLER_CONTRACT_VERSION,
      TestedVersion: '0.1.14',
      Capabilities: [INSTALLER_PARENT_REGISTRATION_CAPABILITY],
    },
  };
}

export async function loadSourceSnapshot(source: ReleaseSource, fetcher: typeof fetch = fetch): Promise<SourceSnapshot> {
  let commitSha: string;
  let baseUrl: string;

  if (source.kind === 'main') {
    const snapshot = (await fetchJson(new URL('./main/snapshot.json', document.baseURI).href, 'Main Fork snapshot metadata', fetcher)) as { commitSha?: unknown };
    commitSha = typeof snapshot.commitSha === 'string' ? snapshot.commitSha : 'main-build';
    baseUrl = new URL('./main/', document.baseURI).href;
  } else {
    if (!source.tagName) throw new Error('The selected release does not have a tag.');
    commitSha = await resolveReleaseSha(source.tagName, fetcher);
    baseUrl = `${RAW_ROOT}/${commitSha}/`;
  }

  const manifestValue = await fetchJson(`${baseUrl}manifest.json`, `${source.label} manifest`, fetcher);
  const manifest = validateManifest(applyLegacyInstallerCompatibility(manifestValue, source, commitSha));
  const projectResources = await Promise.all(
    manifest.Files.map(async (fileName): Promise<InstallResource> => ({
      macroName: macroName(fileName),
      fileName,
      content: await fetchText(`${baseUrl}${encodeURIComponent(fileName)}`, fileName, fetcher),
      kind: 'project',
    })),
  );
  const externalResources = await Promise.all(
    manifest.ExternalDependencies.map(async (dependency): Promise<InstallResource> => ({
      macroName: dependency.Name,
      fileName: new URL(dependency.RawUrl).pathname.split('/').pop() || `${dependency.Name}.js`,
      content: await fetchText(dependency.RawUrl, dependency.Name, fetcher),
      kind: 'external',
    })),
  );

  return {
    source,
    commitSha,
    manifest,
    resources: [...projectResources, ...externalResources],
  };
}
