import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('installer workflow presentation', () => {
  it('uses Companion Device connection language and conditional certificate recovery', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('Companion Board Host address');
    expect(source).toContain('Companion Device Serial');
    expect(source).toContain('The serial is used for Device Verification prior to Installation');
    expect(source).toContain('Companion Device Username');
    expect(source).toContain('Companion Device Password');
    expect(source).toContain('this.certificatePromptVisible ?');
    expect(source).not.toContain('Expected serial number');
    expect(source).not.toContain('The serial read from the Board is never displayed or logged.');
  });

  it('keeps the complete Config object visible and ends with on-device setup', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain('Full Config object');
    expect(source).toContain('const config = ${escapeHtml(JSON.stringify(config, null, 2))};');
    expect(source).toContain("'Complete Setup'");
    expect(source).toContain('Complete setup on the Companion Device');
    expect(source).toContain('this.completeInstallation()');
  });

  it('requires an installation type before review and repeats clean-install consequences', async () => {
    const source = await readFile(new URL('./app.ts', import.meta.url), 'utf8');

    expect(source).toContain("'Installation Type'");
    expect(source).toContain('Install Custom Companion 2026 Macros');
    expect(source).toContain('Purge ${GENERATED_STORAGE_MACRO} and Install Custom Companion 2026 Macros');
    expect(source).toContain("this.installationType === 'clean'");
    expect(source).toContain("this.installationType === 'clean' ? `<div class=\"notice warning\"");
    expect(source).toContain('Generated storage is governed only by the selected installation type');
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
