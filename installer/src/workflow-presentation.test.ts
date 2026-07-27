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
    expect(source.match(/placeholder="0\.0\.0\.0"/g)).toHaveLength(2);
    expect(source).not.toMatch(/placeholder="[^"]*(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
    expect(source).not.toContain('Expected serial number');
    expect(source).not.toContain('The serial read from the Companion Device is never displayed or logged.');
  });

  it('keeps HTTPClient preflight and browser WSS certificate recovery distinct', async () => {
    const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
    const deviceSource = await readFile(new URL('./device.ts', import.meta.url), 'utf8');

    expect(deviceSource).toContain('Set xConfiguration HttpClient Mode to On, then reconnect.');
    expect(deviceSource).toContain("xapi.config.get('HttpClient Mode')");
    expect(deviceSource).toContain("xapi.config.get('HttpClient AllowInsecureHTTPS')");
    expect(deviceSource).toContain("xapi.config.on('HttpClient AllowInsecureHTTPS'");
    expect(deviceSource).not.toContain("xapi.config.set('HttpClient");
    expect(appSource).toContain('HTTPClient Trust Posture');
    expect(appSource).toContain('The installer monitors it while connected and never changes it.');
    expect(appSource).toContain('Before connecting, set xConfiguration HttpClient Mode to On');
    expect(appSource).toContain('data-httpclient-posture-label');
    expect(appSource).toContain('httpClientTrustPostureSubscription');
    expect(appSource).toContain('Certificate trust may be blocking sign-in');
    expect(appSource).toContain('Open Companion Device certificate page');
  });

  it('shows whole-solution and selected-release prerequisites before connection', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('Solution prerequisites');
    expect(source).toContain('Selected-release requirements');
    expect(source).toContain('Review selected release');
    expect(source).toContain('manifest.MinimumRoomOSVersion');
    expect(source).toContain('manifest.ProductPlatform.join');
    expect(source).toContain('manifest.ExternalDependencies');
    expect(source).toContain('If you are not provisioning trusted, host-matching endpoint certificates');
  });

  it('uses multiline User Guidance controls and repeats HTTPClient prerequisites for Parent registration', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./app.ts', import.meta.url), 'utf8'),
      readFile(new URL('./styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain("key.toLowerCase() === 'userguidance'");
    expect(source).toContain('data-value-type="string" rows="4"');
    expect(source).toContain('Configure HTTPClient on both devices before registration');
    expect(source).toContain('set <code>HttpClient AllowInsecureHTTPS: True</code> on both devices');
    expect(styles).toMatch(/\.multiline-config-field\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  });

  it('requires an explicit administrator acknowledgement to explore an unsupported product', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('id="unsupported-product-confirm"');
    expect(source).toContain('Unsupported device exploration');
    expect(source).toContain('this.unsupportedProductConfirmed');
    expect(source).toContain('Exploration bypass acknowledged');
    expect(source).not.toContain('is not supported by the selected release.');
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
    expect(source).toContain('this.parentRegistrationModalOpen && this.currentCompleteSetupCapabilities().parentRegistration ? this.renderParentRegistrationModal()');
    expect(source).toContain('createParentRegistrationRequest');
    expect(source).toContain('sendParentRegistrationRequest');
    expect(source).toContain('Nothing is shown in the Companion Device in-room interface');
    expect(source).toContain("'Complete Setup'");
    expect(source).toContain('Complete setup on the Companion Device');
    expect(source).toContain('The Companion Device interface is the recommended way to register Parent Room Devices.');
    expect(source).toContain('Companion Device registration walkthrough');
    expect(source).toContain('Board registration is recommended.');
    expect(source).toContain('class="browser-parent-option"');
    expect(source).toContain("capabilities.parentRegistration ? `<section class=\"browser-parent-option\"");
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
    expect(source).toContain('this.currentCompleteSetupCapabilities().parentInventory');
    expect(source).toContain('capabilities.parentDeregistration ? `<button');
    expect(source).toContain('!this.currentCompleteSetupCapabilities().parentDeregistration');
    expect(source).toContain('!this.currentCompleteSetupCapabilities().parentRegistration');
    expect(source).toContain('Tested with installer v');
  });

  it('offers installer-computer defaults and safe icon previews in Configure', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./app.ts', import.meta.url), 'utf8'),
      readFile(new URL('./styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain('Selected installation source');
    expect(source).toContain('Version ${escapeHtml(selectedVersion)}');
    expect(source).toContain('leaf.description');
    expect(source).toContain('id="use-computer-location"');
    expect(source).toContain('Use Computer Location');
    expect(source).toContain('id="use-computer-time-zone"');
    expect(source).toContain('Use Computer Time Zone');
    expect(source).toContain('data-icon-preview-for');
    expect(source).toContain('Preview unavailable');
    expect(styles).toMatch(/\.config-icon-preview-frame\s*\{[^}]*background:\s*var\(--mds-color-core-gray-90,\s*#1f2226\)/s);
    expect(styles).not.toMatch(/\.config-icon-preview-frame\s*\{[^}]*linear-gradient/s);
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
