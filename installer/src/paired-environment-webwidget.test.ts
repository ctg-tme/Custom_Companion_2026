import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

type WebWidget = {
  panelId: string;
  name: string;
  refreshInterval: number;
  url: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function loadRuntimeModules() {
  const uiSource = await readFile(new URL('../../Custom-Campanion_4_UI_2026.js', import.meta.url), 'utf8');
  const pairedEnvironmentSource = await readFile(new URL('../../Custom-Campanion_10_PairedEnvironment_2026.js', import.meta.url), 'utf8');
  const harnessId = `${Date.now()}-${Math.random()}`;
  const uiModuleUrl = `data:text/javascript;base64,${Buffer.from(uiSource).toString('base64')}#paired-environment-webwidget-${harnessId}`;
  const pairedEnvironmentModuleUrl = `data:text/javascript;base64,${Buffer.from(pairedEnvironmentSource).toString('base64')}#paired-environment-webwidget-${harnessId}`;
  const { companionUi } = await import(uiModuleUrl) as {
    companionUi: Record<string, unknown>;
  };
  const { pairedEnvironment } = await import(pairedEnvironmentModuleUrl) as {
    pairedEnvironment: {
      create: (options: Record<string, unknown>) => {
        applyRuntimeWebWidget: (mode?: string) => Promise<void>;
        captureStandaloneConfig: (options?: Record<string, unknown>) => Promise<boolean>;
        initializeUiFeatureMode: () => Promise<void>;
        setStandaloneUiFeatureConfig: (value: Record<string, unknown>) => void;
      };
    };
  };

  return { companionUi, pairedEnvironment };
}

async function createHarness(restoreStandaloneExisting: boolean, enabled = true) {
  const { companionUi, pairedEnvironment } = await loadRuntimeModules();
  const existingWebWidget: WebWidget = {
    panelId: 'existingWebWidget',
    name: 'Existing WebWidget',
    refreshInterval: 45,
    url: 'https://example.test/existing',
  };
  let installedWebWidget: WebWidget | null = { ...existingWebWidget };
  const layoutUpdatedHandlers: Array<() => void> = [];
  let mode = 'Standalone';
  let removalError: Error | undefined;
  const operations: Array<{ operation: string; params?: Record<string, unknown> }> = [];
  const write = vi.fn(async () => undefined);
  const warn = vi.fn();
  const softError = vi.fn();
  const themeGet = vi.fn(async () => 'EveningFjord');
  const themeOn = vi.fn();
  const unrelatedEnvironmentSubscription = vi.fn();
  const buildCompanionWebWidgetUrl = vi.spyOn(
    companionUi as { buildCompanionWebWidgetUrl: (options: Record<string, unknown>) => string },
    'buildCompanionWebWidgetUrl',
  );

  const xapi = {
    Config: {
      UserInterface: {
        MuteWarning: {
          get: async () => 'Enabled',
          on: unrelatedEnvironmentSubscription,
        },
        Theme: {
          Name: {
            get: themeGet,
            on: themeOn,
          },
        },
      },
    },
    Event: {
      UserInterface: {
        Extensions: {
          Widget: {
            LayoutUpdated: {
              on: (handler: () => void) => {
                layoutUpdatedHandlers.push(handler);
              },
            },
          },
        },
      },
    },
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
                  ActivityData: installedWebWidget.url,
                }] : [],
              },
            };
          },
          WebWidget: {
            Remove: async (params: Record<string, unknown>) => {
              operations.push({ operation: 'Remove', params });
              if (removalError) throw removalError;
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
        CompanionWidget: {
          enabled,
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
      softError,
    },
  });

  return {
    controller,
    existingWebWidget,
    getInstalledWebWidget: () => installedWebWidget,
    operations,
    setInstalledWebWidget: (value: WebWidget | null) => {
      installedWebWidget = value;
    },
    setMode: (value: string) => {
      mode = value;
    },
    setRemovalError: (error: Error | undefined) => {
      removalError = error;
    },
    setWebWidgetInventory: (
      inventory: (xapi: Record<string, unknown>) => Promise<WebWidget | null>,
    ) => {
      (companionUi as {
        getCurrentWebWidget: (xapi: Record<string, unknown>) => Promise<WebWidget | null>;
      }).getCurrentWebWidget = inventory;
    },
    triggerLayoutUpdated: () => {
      if (!layoutUpdatedHandlers.length) {
        throw new Error('LayoutUpdated subscription was not registered');
      }
      for (const handler of layoutUpdatedHandlers) handler();
    },
    buildCompanionWebWidgetUrl,
    getLayoutUpdatedSubscriptionCount: () => layoutUpdatedHandlers.length,
    softError,
    themeGet,
    themeOn,
    unrelatedEnvironmentSubscription,
    warn,
    write,
  };
}

describe('Paired Environment WebWidget ownership', () => {
  it('removes the solution-owned WebWidget without starting the workflow when disabled', async () => {
    const harness = await createHarness(true, false);
    harness.setInstalledWebWidget({
      panelId: 'cc26WebWidget',
      name: 'Custom Companion 2026',
      refreshInterval: 0,
      url: 'https://ctg-tme.github.io/Simple-WebWidget/',
    });

    await harness.controller.initializeUiFeatureMode();
    await harness.controller.applyRuntimeWebWidget('Standalone');

    expect(harness.getInstalledWebWidget()).toBeNull();
    expect(harness.operations).toEqual([{
      operation: 'Remove',
      params: { PanelId: 'cc26WebWidget' },
    }]);
    expect(() => harness.triggerLayoutUpdated()).toThrow('LayoutUpdated subscription was not registered');
  });

  it('leaves a user-owned WebWidget untouched when the workflow is disabled', async () => {
    const harness = await createHarness(true, false);

    await harness.controller.initializeUiFeatureMode();

    expect(harness.getInstalledWebWidget()).toEqual(harness.existingWebWidget);
    expect(harness.operations).toEqual([{
      operation: 'Remove',
      params: { PanelId: 'cc26WebWidget' },
    }]);
    expect(harness.themeGet).not.toHaveBeenCalled();
    expect(harness.themeOn).not.toHaveBeenCalled();
    expect(harness.buildCompanionWebWidgetUrl).not.toHaveBeenCalled();
    expect(harness.unrelatedEnvironmentSubscription).toHaveBeenCalledOnce();
  });

  it('reports one stable warning when the disabled removal attempt fails without retrying', async () => {
    const harness = await createHarness(true, false);
    harness.setRemovalError(new Error('already absent'));

    await expect(harness.controller.initializeUiFeatureMode()).resolves.toBeUndefined();
    await harness.controller.applyRuntimeWebWidget('Standalone');

    expect(harness.operations).toEqual([{
      operation: 'Remove',
      params: { PanelId: 'cc26WebWidget' },
    }]);
    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(harness.warn).toHaveBeenCalledWith(expect.objectContaining({
      Code: 'CC26-WEBWIDGET-DISABLED-REMOVE',
    }));
  });

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

  it('relearns an original WebWidget after an empty snapshot was persisted', async () => {
    const harness = await createHarness(true);
    harness.controller.setStandaloneUiFeatureConfig({
      webWidget: {
        ...harness.existingWebWidget,
        url: '',
      },
      webWidgetUrl: '',
    });

    await harness.controller.captureStandaloneConfig({ onlyMissing: true });

    expect(harness.operations.map(({ operation }) => operation)).toEqual(['List']);
    expect(harness.write).toHaveBeenCalledWith('standalone-ui', expect.objectContaining({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    }));
  });

  it('tracks an administrator WebWidget change as the current Standalone preference', async () => {
    const harness = await createHarness(true);
    const updatedWebWidget: WebWidget = {
      panelId: 'updatedWebWidget',
      name: 'Updated WebWidget',
      refreshInterval: 90,
      url: 'https://example.test/updated',
    };

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.setInstalledWebWidget(updatedWebWidget);
    harness.triggerLayoutUpdated();

    await vi.waitFor(() => {
      expect(harness.write).toHaveBeenCalledWith('standalone-ui', expect.objectContaining({
        webWidget: updatedWebWidget,
        webWidgetUrl: updatedWebWidget.url,
      }));
    });

    harness.setMode('Paired');
    await harness.controller.applyRuntimeWebWidget('Paired');
    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');

    expect(harness.getInstalledWebWidget()).toEqual(updatedWebWidget);
  });

  it('retains the durable snapshot after a failed write and retries the identical event', async () => {
    const harness = await createHarness(true);
    const updatedWebWidget: WebWidget = {
      panelId: 'updatedWebWidget',
      name: 'Updated WebWidget',
      refreshInterval: 90,
      url: 'https://example.test/updated',
    };

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.softError.mockClear();
    harness.write
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    harness.setInstalledWebWidget(updatedWebWidget);
    harness.triggerLayoutUpdated();

    await vi.waitFor(() => {
      expect(harness.softError).toHaveBeenCalledOnce();
    });
    harness.triggerLayoutUpdated();
    await vi.waitFor(() => {
      expect(harness.write).toHaveBeenCalledTimes(2);
    });

    expect(harness.write).toHaveBeenLastCalledWith('standalone-ui', expect.objectContaining({
      webWidget: updatedWebWidget,
      webWidgetUrl: updatedWebWidget.url,
    }));
  });

  it('does not govern a newly observed WebWidget when persistence fails', async () => {
    const harness = await createHarness(true);
    const updatedWebWidget: WebWidget = {
      panelId: 'updatedWebWidget',
      name: 'Updated WebWidget',
      refreshInterval: 90,
      url: 'https://example.test/updated',
    };
    harness.controller.setStandaloneUiFeatureConfig({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    });
    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.softError.mockClear();
    harness.write.mockRejectedValueOnce(new Error('storage unavailable'));
    harness.setInstalledWebWidget(updatedWebWidget);
    harness.triggerLayoutUpdated();
    await vi.waitFor(() => {
      expect(harness.softError).toHaveBeenCalledOnce();
    });

    harness.setMode('Paired');
    await harness.controller.applyRuntimeWebWidget('Paired');
    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');

    expect(harness.getInstalledWebWidget()).toEqual(harness.existingWebWidget);
  });

  it('does not learn a value when the runtime becomes Paired during inventory', async () => {
    const harness = await createHarness(true);
    const inventory = deferred<WebWidget | null>();
    const inventorySpy = vi.fn(() => inventory.promise);

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.setWebWidgetInventory(inventorySpy);
    harness.triggerLayoutUpdated();
    await vi.waitFor(() => expect(inventorySpy).toHaveBeenCalledOnce());
    harness.setMode('Paired');
    inventory.resolve({
      panelId: 'paired-during-inventory',
      name: 'Paired During Inventory',
      refreshInterval: 30,
      url: 'https://example.test/paired-during-inventory',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.write).not.toHaveBeenCalled();
  });

  it('serializes rapid layout updates so an older definition cannot overwrite the latest one', async () => {
    const harness = await createHarness(true);
    const firstInventory = deferred<WebWidget | null>();
    const secondInventory = deferred<WebWidget | null>();
    const olderWebWidget: WebWidget = {
      panelId: 'olderWebWidget',
      name: 'Older WebWidget',
      refreshInterval: 30,
      url: 'https://example.test/older',
    };
    const latestWebWidget: WebWidget = {
      panelId: 'latestWebWidget',
      name: 'Latest WebWidget',
      refreshInterval: 60,
      url: 'https://example.test/latest',
    };
    let inventoryCalls = 0;

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.setWebWidgetInventory(async () => {
      inventoryCalls += 1;
      return inventoryCalls === 1 ? firstInventory.promise : secondInventory.promise;
    });
    harness.triggerLayoutUpdated();
    harness.triggerLayoutUpdated();
    await vi.waitFor(() => expect(inventoryCalls).toBeGreaterThanOrEqual(1));

    await Promise.resolve();
    if (inventoryCalls > 1) {
      secondInventory.resolve(latestWebWidget);
      await vi.waitFor(() => expect(harness.write).toHaveBeenCalledWith(
        'standalone-ui',
        expect.objectContaining({ webWidget: latestWebWidget }),
      ));
      firstInventory.resolve(olderWebWidget);
    } else {
      firstInventory.resolve(olderWebWidget);
      await vi.waitFor(() => expect(inventoryCalls).toBe(2));
      secondInventory.resolve(latestWebWidget);
    }
    await vi.waitFor(() => expect(harness.write).toHaveBeenCalledTimes(2));

    expect(harness.write).toHaveBeenLastCalledWith('standalone-ui', expect.objectContaining({
      webWidget: latestWebWidget,
      webWidgetUrl: latestWebWidget.url,
    }));
  });

  it('does not write an unchanged WebWidget definition', async () => {
    const harness = await createHarness(true);

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.triggerLayoutUpdated();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.write).not.toHaveBeenCalled();
  });

  it('captures a newer user-owned WebWidget when management is re-enabled in Standalone', async () => {
    const harness = await createHarness(true);
    const newerWebWidget: WebWidget = {
      panelId: 'newerWebWidget',
      name: 'Newer WebWidget',
      refreshInterval: 75,
      url: 'https://example.test/newer',
    };
    harness.controller.setStandaloneUiFeatureConfig({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    });
    harness.setInstalledWebWidget(newerWebWidget);

    await harness.controller.initializeUiFeatureMode();

    expect(harness.write).toHaveBeenCalledWith('standalone-ui', expect.objectContaining({
      webWidget: newerWebWidget,
      webWidgetUrl: newerWebWidget.url,
    }));
    harness.setMode('Paired');
    await harness.controller.applyRuntimeWebWidget('Paired');
    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');
    expect(harness.getInstalledWebWidget()).toEqual(newerWebWidget);
  });

  it('preserves the prior snapshot and current widget when re-enable capture persistence fails', async () => {
    const harness = await createHarness(true);
    const newerWebWidget: WebWidget = {
      panelId: 'newerWebWidget',
      name: 'Newer WebWidget',
      refreshInterval: 75,
      url: 'https://example.test/newer',
    };
    harness.controller.setStandaloneUiFeatureConfig({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    });
    harness.setInstalledWebWidget(newerWebWidget);
    harness.write.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(harness.controller.initializeUiFeatureMode()).rejects.toThrow('storage unavailable');

    expect(harness.getInstalledWebWidget()).toEqual(newerWebWidget);
    harness.write.mockResolvedValue(undefined);
    harness.setMode('Paired');
    await harness.controller.applyRuntimeWebWidget('Paired');
    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');
    expect(harness.getInstalledWebWidget()).toEqual(harness.existingWebWidget);
  });

  it('does not learn a re-enabled WebWidget while Paired', async () => {
    const harness = await createHarness(true);
    const pairedWebWidget: WebWidget = {
      panelId: 'pairedWebWidget',
      name: 'Paired WebWidget',
      refreshInterval: 30,
      url: 'https://example.test/paired',
    };
    harness.controller.setStandaloneUiFeatureConfig({
      webWidget: harness.existingWebWidget,
      webWidgetUrl: harness.existingWebWidget.url,
    });
    harness.setInstalledWebWidget(pairedWebWidget);
    harness.setMode('Paired');

    await harness.controller.initializeUiFeatureMode();

    expect(harness.write).not.toHaveBeenCalled();
    harness.setMode('Standalone');
    await harness.controller.applyRuntimeWebWidget('Standalone');
    expect(harness.getInstalledWebWidget()).toEqual(harness.existingWebWidget);
  });

  it('registers LayoutUpdated and Theme subscriptions at most once per controller', async () => {
    const harness = await createHarness(true);

    await harness.controller.initializeUiFeatureMode();
    await harness.controller.initializeUiFeatureMode();

    expect(harness.getLayoutUpdatedSubscriptionCount()).toBe(1);
    expect(harness.themeOn).toHaveBeenCalledOnce();
  });

  it('does not learn a WebWidget layout change while Paired', async () => {
    const harness = await createHarness(true);

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.setMode('Paired');
    harness.setInstalledWebWidget({
      panelId: 'pairedWebWidget',
      name: 'Paired WebWidget',
      refreshInterval: 30,
      url: 'https://example.test/paired',
    });
    harness.triggerLayoutUpdated();

    expect(harness.write).not.toHaveBeenCalled();
  });

  it('does not learn the solution-owned WebWidget from a Standalone layout update', async () => {
    const harness = await createHarness(true);

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    const listCountBeforeUpdate = harness.operations.filter(({ operation }) => operation === 'List').length;
    harness.setInstalledWebWidget({
      panelId: 'cc26WebWidget',
      name: 'Custom Companion 2026',
      refreshInterval: 0,
      url: 'https://example.test/companion',
    });
    harness.triggerLayoutUpdated();

    await vi.waitFor(() => {
      expect(harness.operations.filter(({ operation }) => operation === 'List')).toHaveLength(listCountBeforeUpdate + 1);
    });
    expect(harness.write).not.toHaveBeenCalled();
  });

  it('ignores empty and malformed Standalone WebWidget definitions', async () => {
    const harness = await createHarness(true);
    const inventory = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        panelId: '',
        name: 'Missing Panel Id',
        refreshInterval: 30,
        url: 'https://example.test/malformed',
      } satisfies WebWidget)
      .mockResolvedValueOnce({
        panelId: 'invalidRefresh',
        name: 'Invalid Refresh',
        refreshInterval: Number.NaN,
        url: 'https://example.test/malformed',
      } satisfies WebWidget);

    await harness.controller.initializeUiFeatureMode();
    harness.write.mockClear();
    harness.setWebWidgetInventory(inventory);

    for (let expectedCalls = 1; expectedCalls <= 3; expectedCalls += 1) {
      harness.triggerLayoutUpdated();
      await vi.waitFor(() => expect(inventory).toHaveBeenCalledTimes(expectedCalls));
    }

    expect(harness.write).not.toHaveBeenCalled();
  });

  it('uses the canonical release-owned Simple-WebWidget URL when enabled', async () => {
    const harness = await createHarness(false);

    await harness.controller.applyRuntimeWebWidget('Standalone');

    const save = harness.operations.find(({ operation }) => operation === 'Save');
    expect(save?.params?.URL).toMatch(/^https:\/\/ctg-tme\.github\.io\/Simple-WebWidget\/#/);
  });
});
