import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type WebWidget = {
  panelId: string;
  name: string;
  refreshInterval: number;
  url: string;
};

async function loadRuntimeModules() {
  const uiSource = await readFile(new URL('../../Custom-Campanion_4_UI_2026.js', import.meta.url), 'utf8');
  const pairedEnvironmentSource = await readFile(new URL('../../Custom-Campanion_10_PairedEnvironment_2026.js', import.meta.url), 'utf8');
  const uiModuleUrl = `data:text/javascript;base64,${Buffer.from(uiSource).toString('base64')}#paired-environment-webwidget`;
  const pairedEnvironmentModuleUrl = `data:text/javascript;base64,${Buffer.from(pairedEnvironmentSource).toString('base64')}#paired-environment-webwidget`;
  const { companionUi } = await import(uiModuleUrl) as {
    companionUi: Record<string, unknown>;
  };
  const { pairedEnvironment } = await import(pairedEnvironmentModuleUrl) as {
    pairedEnvironment: {
      create: (options: Record<string, unknown>) => {
        applyRuntimeWebWidget: (mode?: string) => Promise<void>;
        captureStandaloneConfig: (options?: Record<string, unknown>) => Promise<boolean>;
      };
    };
  };

  return { companionUi, pairedEnvironment };
}

async function createHarness(restoreStandaloneExisting: boolean) {
  const { companionUi, pairedEnvironment } = await loadRuntimeModules();
  const existingWebWidget: WebWidget = {
    panelId: 'existingWebWidget',
    name: 'Existing WebWidget',
    refreshInterval: 45,
    url: 'https://example.test/existing',
  };
  let installedWebWidget: WebWidget | null = { ...existingWebWidget };
  let mode = 'Standalone';
  const operations: Array<{ operation: string; params?: Record<string, unknown> }> = [];
  const write = vi.fn(async () => undefined);
  const warn = vi.fn();

  const xapi = {
    Config: {},
    Status: {
      Proximity: {},
      UserInterface: {
        WebView: {
          get: async () => [],
        },
      },
    },
    Command: {
      UserInterface: {
        Extensions: {
          List: async (params: Record<string, unknown>) => {
            operations.push({ operation: 'List', params });
            return {
              Extensions: {
                Panel: installedWebWidget ? [{
                  ActivityType: 'WebWidget',
                  Name: installedWebWidget.name,
                  PanelId: installedWebWidget.panelId,
                  RefreshInterval: installedWebWidget.refreshInterval,
                  URL: installedWebWidget.url,
                }] : [],
              },
            };
          },
          WebWidget: {
            Remove: async (params: Record<string, unknown>) => {
              operations.push({ operation: 'Remove', params });
              if (installedWebWidget?.panelId === params.PanelId) {
                installedWebWidget = null;
              }
            },
            Save: async (params: Record<string, unknown>) => {
              operations.push({ operation: 'Save', params });
              if (installedWebWidget && installedWebWidget.panelId !== params.PanelId) {
                throw new Error('Only one web widget supported');
              }
              installedWebWidget = {
                panelId: String(params.PanelId),
                name: String(params.Name),
                refreshInterval: Number(params.RefreshInterval),
                url: String(params.URL),
              };
            },
          },
        },
      },
    },
  };

  const controller = pairedEnvironment.create({
    xapi,
    companionUi,
    mem: { write },
    storageKey: 'standalone-ui',
    environmentStorageKey: 'standalone-environment',
    userInterfaceConfig: {
      WebWidget: {
        urlOverride: 'https://example.test/companion',
        CompanionWidget: {
          enabled: true,
          restoreStandaloneExisting,
          Standalone: {},
          Paired: {},
        },
      },
    },
    policy: {},
    callbacks: {
      getRuntimeContext: () => ({
        activeParentName: 'Parent Room',
        isUnhealthy: false,
        mode,
        runtimeInfo3: '',
      }),
    },
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn,
    },
    utils: {
      softError: vi.fn(),
    },
  });

  return {
    controller,
    existingWebWidget,
    getInstalledWebWidget: () => installedWebWidget,
    operations,
    setMode: (value: string) => {
      mode = value;
    },
    warn,
    write,
  };
}

describe('Paired Environment WebWidget ownership', () => {
  it('replaces an existing WebWidget without retaining it when restoration is disabled', async () => {
    const harness = await createHarness(false);

    await harness.controller.applyRuntimeWebWidget('Standalone');

    expect(harness.getInstalledWebWidget()).toMatchObject({
      panelId: 'cc26WebWidget',
      name: 'Custom Companion 2026',
    });
    expect(harness.operations.map(({ operation }) => operation)).toEqual([
      'List',
      'Remove',
      'Save',
    ]);
    expect(harness.operations[1]).toEqual({
      operation: 'Remove',
      params: { PanelId: 'existingWebWidget' },
    });
    expect(harness.warn).not.toHaveBeenCalledWith(expect.objectContaining({
      Error: 'Only one web widget supported',
    }));
  });

  it('captures, replaces, and restores the original Standalone WebWidget', async () => {
    const harness = await createHarness(true);

    await harness.controller.captureStandaloneConfig({ onlyMissing: true });

    expect(harness.write).toHaveBeenCalledWith('standalone-ui', expect.objectContaining({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    }));

    harness.setMode('Paired');
    await harness.controller.applyRuntimeWebWidget('Paired');
    expect(harness.getInstalledWebWidget()).toMatchObject({
      panelId: 'cc26WebWidget',
      name: 'Custom Companion 2026',
    });

    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');
    expect(harness.getInstalledWebWidget()).toEqual(harness.existingWebWidget);
    expect(harness.operations.map(({ operation }) => operation)).toEqual([
      'List',
      'List',
      'Remove',
      'Save',
      'List',
      'Remove',
      'Save',
    ]);
    expect(harness.operations[2]).toEqual({
      operation: 'Remove',
      params: { PanelId: 'existingWebWidget' },
    });
    expect(harness.operations[5]).toEqual({
      operation: 'Remove',
      params: { PanelId: 'cc26WebWidget' },
    });
  });
});
