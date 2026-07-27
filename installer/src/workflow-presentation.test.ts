import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('installer workflow presentation', () => {
  it('uses Companion Device connection language and conditional certificate recovery', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('Companion Device host address');
    expect(source).toContain('Companion Device Serial');
    expect(source).toContain('The serial is used for Device Verification prior to Installation');
    expect(source).toContain('Companion Device Username');
    expect(source).toContain('Companion Device Password');
    expect(source).toContain('this.certificatePromptVisible ?');
    expect(source).not.toContain('Expected serial number');
    expect(source).not.toContain('The serial read from the Companion Device is never displayed or logged.');
  });

  it('keeps installer Parent Room Registration optional from Complete Setup', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('Configuration summary');
    expect(source).not.toContain('Full Config object');
    expect(source).toContain('humanizeConfigForReview(redactConfig(withLeafValues');
    expect(source).toContain('Every generated setting is shown with human-facing labels.');
    expect(source).toContain("const STEPS = ['Introduction', 'Release', 'Connect', 'Configure', 'Installation Type', 'Review', 'Install', 'Complete Setup']");
    expect(source).not.toContain("'Register Parent Room Device', 'Complete Setup'");
    expect(source).toContain('id="add-parent"');
    expect(source).toContain('Add Parent');
    expect(source).toContain('this.parentRegistrationModalOpen ? this.renderParentRegistrationModal()');
    expect(source).toContain('createParentRegistrationRequest');
    expect(source).toContain('sendParentRegistrationRequest');
    expect(source).toContain('Nothing is shown in the Companion Device in-room interface');
    expect(source).toContain("'Complete Setup'");
    expect(source).toContain('Complete setup on the Companion Device');
    expect(source).toContain('The Companion Device interface is the recommended way to register Parent Room Devices.');
    expect(source).toContain('Companion Device registration walkthrough');
    expect(source).toContain('Board registration is recommended.');
    expect(source).toContain('class="browser-parent-option"');
    expect(source).toContain('class="button primary" id="finish-setup"');
    expect(source).not.toContain('Add Parent Room Devices (optional)');
    expect(source).toContain('continueToCompleteSetup()');
    expect(source).toContain('this.companionDevice?.close();');
  });

  it('requires an installation type before review and repeats clean-install consequences', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain("'Installation Type'");
    expect(source).toContain('Install or Update — Keep Saved Data');
    expect(source).toContain('Fresh Installation — Erase Saved Data');
    expect(source).toContain('captured Standalone Paired Environment and standby preferences');
    expect(source).toContain("this.installationType === 'fresh'");
    expect(source).toContain("this.installationType === 'fresh' ? `<div class=\"notice warning\"");
    expect(source).toContain('Generated storage is governed only by the selected installation type');
  });

  it('supports guarded backward progress navigation and one connected device session', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('data-workflow-step');
    expect(source).toContain('navigateBackward');
    expect(source).toContain('if (this.companionDevice)');
    expect(source).toContain('Connected to this Companion Device');
    expect(source).toContain('id="disconnect-device"');
    expect(source).toContain('id="confirm-disconnect"');
    expect(source).toContain('Disconnect from this Companion Device?');
    expect(source).toContain('The selected release remains prepared.');
  });

  it('shows the installer version and Parent Room administration on Complete Setup', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('INSTALLER_VERSION');
    expect(source).toContain('Installer version');
    expect(source).toContain('Parent Room Registrations');
    expect(source).toContain('Pending Deregistrations');
    expect(source).toContain('id="refresh-parent-inventory"');
    expect(source).toContain('data-remove-parent');
    expect(source).toContain('Deregister Parent Room Device?');
    expect(source).toContain('No Parent Room Registrations are saved on this Companion Device.');
    expect(source).toContain('parentInventoryPlanAfterInstallation');
  });

  it('offers installer-computer defaults and safe icon previews in Configure', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('id="use-computer-location"');
    expect(source).toContain('Use Computer Location');
    expect(source).toContain('id="use-computer-time-zone"');
    expect(source).toContain('Use Computer Time Zone');
    expect(source).toContain('data-icon-preview-for');
    expect(source).toContain('Preview unavailable');
  });

  it('uses document scrolling instead of a dynamic-viewport-height trap', async () => {
    const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).not.toMatch(/html,\s*body,\s*#app\s*\{[^}]*(?:^|[;\s])height:\s*100%/s);
    expect(styles).not.toMatch(/html,\s*body,\s*#app\s*\{[^}]*overflow:\s*hidden/s);
    expect(styles).not.toMatch(/\.app-shell\s*\{[^}]*height:\s*100dvh/s);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*100vh/s);
    expect(styles).toMatch(/\.workspace-actions\s*\{[^}]*position:\s*sticky/s);
  });

  it('turns README headings into nested disclosure sections', async () => {
    const [readmeSource, mermaidSource] = await Promise.all([
      readFile(new URL('./readme.ts', import.meta.url), 'utf8'),
      readFile(new URL('./mermaid.ts', import.meta.url), 'utf8'),
    ]);

    expect(readmeSource).toContain("document.createElement('details')");
    expect(readmeSource).toContain("document.createElement('summary')");
    expect(readmeSource).toContain('collapseReadmeHeadings(container)');
    expect(mermaidSource).toContain('if (!details.open) return false');
  });
});
