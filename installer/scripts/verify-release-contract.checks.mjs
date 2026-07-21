import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const version = '1.2.3.4';
const contract = {
  MainMacroFile: 'Custom-Campanion_1_Main_2026.js',
  ConfigMacroFile: 'Custom-Campanion_2_Config_2026.js',
  RoomReferenceMacroFile: 'Custom-Campanion_7_RoomReference_2026.js',
  InitializationSuccessMessage: 'Custom Campanion initialized',
  InitializationStoppedMessage: 'Custom Campanion board initialization stopped',
};

function header(value = version) {
  return `/**\n * Version:                 ${value}\n */\n`;
}

async function createFixture(overrides = {}) {
  const repositoryDirectory = await mkdtemp(join(tmpdir(), 'custom-companion-release-contract-'));
  const installerDirectory = join(repositoryDirectory, 'installer');
  await mkdir(installerDirectory, { recursive: true });

  const sources = {
    [contract.MainMacroFile]: `${header()}console.log('${contract.InitializationSuccessMessage}');\nconsole.log('${contract.InitializationStoppedMessage}');\n`,
    [contract.ConfigMacroFile]: `${header()}const config = { version: '${version}' };\nexport { config };\n`,
    [contract.RoomReferenceMacroFile]: `${header()}export const roomReference = true;\n`,
    ...overrides.sources,
  };
  if (overrides.extraFile) sources[overrides.extraFile] = `${header()}export const extra = true;\n`;

  const manifest = {
    SchemaVersion: 1,
    Files: Object.keys(sources).filter((file) => file !== overrides.extraFile),
    MinimumRoomOSVersion: '11.32.1.1',
    SoftwarePlatform: ['roomos'],
    ProductPlatform: ['Board Pro'],
    ExternalDependencies: [],
  };

  await Promise.all([
    writeFile(join(repositoryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(join(installerDirectory, 'release-contract.json'), `${JSON.stringify(contract, null, 2)}\n`, 'utf8'),
    ...Object.entries(sources).map(([file, source]) => writeFile(join(repositoryDirectory, file), source, 'utf8')),
  ]);

  return repositoryDirectory;
}

async function withFixture(t, overrides = {}) {
  const repositoryDirectory = await createFixture(overrides);
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }));
  return repositoryDirectory;
}

test('accepts a complete synchronized Release Contract', async (t) => {
  const repositoryDirectory = await withFixture(t);
  const result = await verifyReleaseContract(repositoryDirectory);
  assert.equal(result.projectVersion, version);
  assert.equal(result.projectFiles.length, 3);
});

test('rejects a deployable root macro missing from the Release Manifest', async (t) => {
  const repositoryDirectory = await withFixture(t, { extraFile: 'Custom-Campanion_8_Extra_2026.js' });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /missing from manifest/i);
});

test('rejects unsynchronized runtime project versions', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.ConfigMacroFile]: `${header('9.9.9.9')}const config = { version: '${version}' };\nexport { config };\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /versions are not synchronized/i);
});

test('rejects unresolved relative macro imports', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.RoomReferenceMacroFile]: `${header()}import './Custom-Campanion_99_Missing_2026';\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /relative imports absent/i);
});

test('rejects initialization-message drift', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.MainMacroFile]: `${header()}console.log('different success message');\nconsole.log('${contract.InitializationStoppedMessage}');\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /does not emit the Release Contract message/i);
});
