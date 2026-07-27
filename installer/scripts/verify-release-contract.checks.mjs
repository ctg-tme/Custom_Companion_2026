import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyReleaseContract } from './verify-release-contract.mjs';

const version = '1.2.3.4';
const installerVersion = '0.1.20';
const contract = {
  MainMacroFile: 'Custom-Campanion_1_Main_2026.js',
  ConfigMacroFile: 'Custom-Campanion_2_Config_2026.js',
  RoomReferenceMacroFile: 'Custom-Campanion_7_RoomReference_2026.js',
  GeneratedStorageMacro: 'Custom-Campanion-Storage',
  InitializationSuccessMessage: 'Custom Companion initialized on Companion Device',
  InitializationStoppedMessage: 'Custom Companion initialization stopped on Companion Device',
  CompanionInstallerContractVersion: 1,
  InstallerParentRegistrationAction: 'InstallerParentRegistrationRequest',
  InstallerParentRegistrationSuccessMessage: 'Companion Installer Parent Room Registration completed',
  InstallerParentRegistrationFailureMessage: 'Companion Installer Parent Room Registration failed',
  InstallerParentInventoryAction: 'InstallerParentInventoryRequest',
  InstallerParentInventorySuccessMessage: 'Companion Installer Parent Room Inventory completed',
  InstallerParentInventoryFailureMessage: 'Companion Installer Parent Room Inventory failed',
  InstallerParentDeregistrationAction: 'InstallerParentDeregistrationRequest',
  InstallerParentDeregistrationSuccessMessage: 'Companion Installer Parent Room Deregistration completed',
  InstallerParentDeregistrationPendingMessage: 'Companion Installer Parent Room Deregistration pending',
  InstallerParentDeregistrationFailureMessage: 'Companion Installer Parent Room Deregistration failed',
  InstallerCapabilityContracts: {
    'installer.parent-deregistration.v1': [
      'InstallerParentDeregistrationAction',
      'InstallerParentDeregistrationSuccessMessage',
      'InstallerParentDeregistrationPendingMessage',
      'InstallerParentDeregistrationFailureMessage',
    ],
    'installer.parent-inventory.v1': [
      'InstallerParentInventoryAction',
      'InstallerParentInventorySuccessMessage',
      'InstallerParentInventoryFailureMessage',
    ],
    'installer.parent-registration.v1': [
      'InstallerParentRegistrationAction',
      'InstallerParentRegistrationSuccessMessage',
      'InstallerParentRegistrationFailureMessage',
    ],
  },
  InstallerCapabilityDependencies: {
    'installer.parent-deregistration.v1': [
      'installer.parent-inventory.v1',
    ],
  },
};

function header(value = version) {
  return `/**\n * Version:                 ${value}\n */\n`;
}

function runtimeContractSource(keys = Object.keys(contract)) {
  return keys
    .filter((key) => key.startsWith('Initialization') || key.startsWith('InstallerParent'))
    .map((key) => `console.log('${contract[key]}');`)
    .join('\n') + '\n';
}

async function createFixture(overrides = {}) {
  const repositoryDirectory = await mkdtemp(join(tmpdir(), 'custom-companion-release-contract-'));
  const installerDirectory = join(repositoryDirectory, 'installer');
  await mkdir(installerDirectory, { recursive: true });

  const sources = {
    [contract.MainMacroFile]: `${header()}${runtimeContractSource()}`,
    [contract.ConfigMacroFile]: `${header()}const projectVersion = '${version}';\nconst config = {};\nexport { config, projectVersion };\n`,
    [contract.RoomReferenceMacroFile]: `${header()}export const roomReference = true;\n`,
    ...overrides.sources,
  };
  if (overrides.extraFile) sources[overrides.extraFile] = `${header()}export const extra = true;\n`;

  const manifest = {
    SchemaVersion: 1,
    CompanionInstaller: {
      ContractVersion: 1,
      TestedVersion: installerVersion,
      Capabilities: Object.keys(contract.InstallerCapabilityContracts),
    },
    Files: Object.keys(sources).filter((file) => file !== overrides.extraFile),
    MinimumRoomOSVersion: '11.32.1.1',
    SoftwarePlatform: ['roomos'],
    ProductPlatform: ['Board Pro'],
    ExternalDependencies: [],
  };

  await Promise.all([
    writeFile(join(repositoryDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(join(installerDirectory, 'release-contract.json'), `${JSON.stringify(contract, null, 2)}\n`, 'utf8'),
    writeFile(join(installerDirectory, 'package.json'), `${JSON.stringify({ version: installerVersion }, null, 2)}\n`, 'utf8'),
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

test('rejects a Release Contract without the generated storage macro anchor', async (t) => {
  const repositoryDirectory = await withFixture(t);
  const contractWithoutStorage = { ...contract };
  delete contractWithoutStorage.GeneratedStorageMacro;
  await writeFile(
    join(repositoryDirectory, 'installer', 'release-contract.json'),
    `${JSON.stringify(contractWithoutStorage, null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /GeneratedStorageMacro/);
});

test('rejects a deployable root macro missing from the Release Manifest', async (t) => {
  const repositoryDirectory = await withFixture(t, { extraFile: 'Custom-Campanion_8_Extra_2026.js' });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /missing from manifest/i);
});

test('rejects unsynchronized runtime project versions', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.ConfigMacroFile]: `${header('9.9.9.9')}const projectVersion = '${version}';\nconst config = {};\nexport { config, projectVersion };\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /versions are not synchronized/i);
});

test('rejects a Config macro without an exported Project Version dependency', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.ConfigMacroFile]: `${header()}const projectVersion = '${version}';\nconst config = {};\nexport { config };\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /does not export projectVersion/i);
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

test('rejects Installer Parent Room Registration contract drift', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.MainMacroFile]: `${header()}${runtimeContractSource([
        'InitializationSuccessMessage',
        'InitializationStoppedMessage',
        'InstallerParentInventoryAction',
        'InstallerParentInventorySuccessMessage',
        'InstallerParentInventoryFailureMessage',
        'InstallerParentDeregistrationAction',
        'InstallerParentDeregistrationSuccessMessage',
        'InstallerParentDeregistrationPendingMessage',
        'InstallerParentDeregistrationFailureMessage',
      ])}`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /installer\.parent-registration\.v1 Release Contract value/i);
});

test('rejects Installer Parent Room administration contract drift', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.MainMacroFile]: `${header()}${runtimeContractSource([
        'InitializationSuccessMessage',
        'InitializationStoppedMessage',
        'InstallerParentRegistrationAction',
        'InstallerParentRegistrationSuccessMessage',
        'InstallerParentRegistrationFailureMessage',
      ])}`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /installer\.parent-(?:inventory|deregistration)\.v1 Release Contract value/i);
});

test('rejects a Tested Installer Version that does not match the packaged installer', async (t) => {
  const repositoryDirectory = await withFixture(t);
  const manifestPath = join(repositoryDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.CompanionInstaller.TestedVersion = '9.9.9';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /Tested Installer Version must match/i);
});

test('rejects a manifest capability absent from the Release Contract catalog', async (t) => {
  const repositoryDirectory = await withFixture(t);
  const manifestPath = join(repositoryDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.CompanionInstaller.Capabilities.push('installer.unknown-workflow.v1');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /exactly match InstallerCapabilityContracts/i);
});

test('rejects a Release Contract capability with an absent dependency', async (t) => {
  const repositoryDirectory = await withFixture(t);
  const manifestPath = join(repositoryDirectory, 'manifest.json');
  const contractPath = join(repositoryDirectory, 'installer', 'release-contract.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const fixtureContract = JSON.parse(await readFile(contractPath, 'utf8'));
  manifest.CompanionInstaller.Capabilities = ['installer.parent-deregistration.v1'];
  fixtureContract.InstallerCapabilityContracts = {
    'installer.parent-deregistration.v1': fixtureContract.InstallerCapabilityContracts['installer.parent-deregistration.v1'],
  };
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(contractPath, `${JSON.stringify(fixtureContract, null, 2)}\n`, 'utf8'),
  ]);
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /requires Installer Capabilities: installer\.parent-inventory\.v1/i);
});

test('rejects newline characters in UserInterface Message Title and Text fields', async (t) => {
  const repositoryDirectory = await withFixture(t, {
    sources: {
      [contract.MainMacroFile]: `${header()}${runtimeContractSource()}xapi.Command.UserInterface.Message.Prompt.Display({ Title: 'Review', Text: 'Line one\\nLine two' });\n`,
    },
  });
  await assert.rejects(verifyReleaseContract(repositoryDirectory), /UserInterface Message Title and Text fields cannot contain newline characters/i);
});
