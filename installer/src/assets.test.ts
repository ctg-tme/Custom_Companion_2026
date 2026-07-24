import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Momentum Design assets', () => {
  it('loads the Momentum Webex token layers and packaged icons', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    const mainSource = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
    const appSource = await readFile(new URL('./app.ts', import.meta.url), 'utf8');
    const mermaidSource = await readFile(new URL('./mermaid.ts', import.meta.url), 'utf8');

    expect(packageJson.dependencies['@momentum-design/tokens']).toBeTruthy();
    expect(packageJson.dependencies['@momentum-design/icons']).toBeTruthy();
    expect(packageJson.dependencies.mermaid).toBeTruthy();
    expect(mainSource).toContain('@momentum-design/tokens/dist/css/core/complete.css');
    expect(mainSource).toContain('@momentum-design/tokens/dist/css/theme/webex/light-stable.css');
    expect(mainSource).toContain('@momentum-design/tokens/dist/css/typography/complete.css');
    expect(appSource.match(/@momentum-design\/icons\/dist\/svg\//g)?.length).toBeGreaterThanOrEqual(6);
    expect(mermaidSource).toContain("theme: 'base'");
    expect(mermaidSource).toContain("primaryBorderColor: '#1170cf'");
  });
});

describe('generated runtime content', () => {
  it('publishes the current README, Custom Companion icon, and Main Fork version', async () => {
    const [repositoryReadme, publishedReadme, repositoryIcon, publishedIcon, snapshotText, configSource] = await Promise.all([
      readFile(new URL('../../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../public/content/README.md', import.meta.url), 'utf8'),
      readFile(new URL('../../assets/icons/custom-companion-512.png', import.meta.url)),
      readFile(new URL('../public/icons/custom-companion-512.png', import.meta.url)),
      readFile(new URL('../public/main/snapshot.json', import.meta.url), 'utf8'),
      readFile(new URL('../../Custom-Campanion_2_Config_2026.js', import.meta.url), 'utf8'),
    ]);
    const snapshot = JSON.parse(snapshotText) as { ref: string; version: string };
    const currentVersion = configSource.match(/\bversion\s*:\s*['"]([^'"]+)['"]/)?.[1];

    expect(publishedReadme).toBe(repositoryReadme);
    expect(publishedIcon).toEqual(repositoryIcon);
    expect(snapshot.ref).toBe('main');
    expect(snapshot.version).toBe(currentVersion);
    expect(configSource).toContain('https://ctg-tme.github.io/Custom_Companion_2026/icons/custom-companion-512.png');
  });
});
