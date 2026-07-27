import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const PANEL_ICON_URL = 'https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png';

describe('Companion Device UI macro', () => {
  it('dispatches the hard-coded panel icon download first after the UI build', async () => {
    const source = await readFile(new URL('../../Custom-Campanion_4_UI_2026.js', import.meta.url), 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { companionUi } = await import(moduleUrl) as {
      companionUi: {
        savePanel: (
          xapi: unknown,
          parentDevices: unknown[],
          parentDeviceStatus: unknown[],
          activeParentSerial: string,
          pinModeEnabled: boolean,
        ) => Promise<void>;
      };
    };
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = [];
    const xapi = {
      Command: {
        UserInterface: {
          Extensions: {
            Icon: {
              Download: async (params: Record<string, unknown>) => {
                calls.push({ operation: 'Icon.Download', params });
                return { IconId: 'release-icon-id' };
              },
            },
            Panel: {
              Remove: async (params: Record<string, unknown>) => {
                calls.push({ operation: 'Panel.Remove', params });
              },
              Save: async (params: Record<string, unknown>) => {
                calls.push({ operation: 'Panel.Save', params });
              },
              Update: async (params: Record<string, unknown>) => {
                calls.push({ operation: 'Panel.Update', params });
              },
            },
            Widget: {
              SetValue: async (params: Record<string, unknown>) => {
                calls.push({ operation: 'Widget.SetValue', params });
              },
            },
          },
        },
      },
    };

    await companionUi.savePanel(xapi, [], [], 'Standalone', true);

    const lastPanelSave = calls.map(({ operation }) => operation).lastIndexOf('Panel.Save');
    expect(calls[lastPanelSave + 1]).toEqual({
      operation: 'Icon.Download',
      params: { Url: PANEL_ICON_URL },
    });
    expect(calls.find(({ operation }) => operation === 'Panel.Update')).toEqual({
      operation: 'Panel.Update',
      params: {
        Icon: 'Custom',
        IconId: 'release-icon-id',
        PanelId: 'cc26_access',
      },
    });
  });

  it('keeps the cause-specific Unhealthy Infoblock 3 message intact', async () => {
    const source = await readFile(new URL('../../Custom-Campanion_4_UI_2026.js', import.meta.url), 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#unhealthy-info3`;
    const { companionUi } = await import(moduleUrl) as {
      companionUi: {
        buildCompanionWebWidgetUrl: (options: Record<string, unknown>) => string;
      };
    };
    const message = 'Custom Companion is unavailable because device-to-device communication is disabled. Ask a Device Administrator to enable HTTPClient Mode and restart the Macro Runtime.';

    const url = companionUi.buildCompanionWebWidgetUrl({
      mode: 'Standalone',
      runtimeInfo3: message,
      preserveRuntimeInfo3: true,
      webWidgetConfig: {
        Standalone: {},
      },
    });

    const hash = new URLSearchParams(url.split('#')[1]);
    expect(hash.get('info3')).toBe(message);
  });
});
