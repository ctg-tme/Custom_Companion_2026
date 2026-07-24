import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(installerDirectory, '..');
const outputDirectory = join(installerDirectory, 'public', 'main');
const contentDirectory = join(installerDirectory, 'public', 'content');
const iconDirectory = join(installerDirectory, 'public', 'icons');
const { manifest, projectVersion: version } = await verifyReleaseContract(repositoryDirectory);

await rm(outputDirectory, { recursive: true, force: true });
await rm(contentDirectory, { recursive: true, force: true });
await rm(iconDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await mkdir(contentDirectory, { recursive: true });
await mkdir(iconDirectory, { recursive: true });
await cp(join(repositoryDirectory, 'manifest.json'), join(outputDirectory, 'manifest.json'));
await cp(join(repositoryDirectory, 'README.md'), join(contentDirectory, 'README.md'));
await cp(
  join(repositoryDirectory, 'assets', 'icons', 'custom-companion-512.png'),
  join(iconDirectory, 'custom-companion-512.png'),
);

for (const file of manifest.Files) {
  await cp(join(repositoryDirectory, file), join(outputDirectory, file));
}

const commitSha = process.env.GITHUB_SHA || 'local-working-tree';
await writeFile(
  join(outputDirectory, 'snapshot.json'),
  `${JSON.stringify({ ref: 'main', commitSha, version }, null, 2)}\n`,
  'utf8',
);

console.log(`Prepared ${manifest.Files.length} Main Fork ${version} (Beta) files and the public Custom Companion icon from ${commitSha}.`);
