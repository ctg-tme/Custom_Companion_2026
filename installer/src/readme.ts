import DOMPurify from 'dompurify';
import { marked } from 'marked';

const REPOSITORY_BLOB_ROOT = 'https://github.com/ctg-tme/Custom_Companion_2026/blob/main/';
const REPOSITORY_RAW_ROOT = 'https://raw.githubusercontent.com/ctg-tme/Custom_Companion_2026/main/';

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

function collapseReadmeHeadings(container: HTMLElement): void {
  const output = document.createDocumentFragment();
  const stack: Array<{ level: number; body: HTMLElement }> = [];

  for (const node of [...container.childNodes]) {
    const element = node instanceof HTMLElement ? node : undefined;
    const headingMatch = element?.tagName.match(/^H([2-6])$/);
    if (!element || !headingMatch) {
      (stack.at(-1)?.body ?? output).append(node);
      continue;
    }

    const level = Number(headingMatch[1]);
    while (stack.length && stack.at(-1)!.level >= level) stack.pop();

    const details = document.createElement('details');
    details.className = `readme-section readme-section-level-${level}`;
    const summary = document.createElement('summary');
    summary.append(element);
    const body = document.createElement('div');
    body.className = 'readme-section-body';
    details.append(summary, body);
    (stack.at(-1)?.body ?? output).append(details);
    stack.push({ level, body });
  }

  container.replaceChildren(output);
}

export function renderReadmeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false, gfm: true }) as string;
  const sanitized = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
  const container = document.createElement('div');
  container.innerHTML = sanitized;

  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href') || '';
    if (href && !href.startsWith('#') && !isAbsoluteUrl(href)) {
      anchor.href = new URL(href, REPOSITORY_BLOB_ROOT).href;
    }
    if (!href.startsWith('#')) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  }

  for (const image of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    const source = image.getAttribute('src') || '';
    if (source && !isAbsoluteUrl(source)) image.src = new URL(source, REPOSITORY_RAW_ROOT).href;
    image.loading = 'lazy';
  }

  for (const code of container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const diagram = document.createElement('div');
    diagram.className = 'mermaid';
    diagram.dataset.mermaidPending = '';
    diagram.textContent = code.textContent || '';
    const shell = document.createElement('div');
    shell.className = 'mermaid-diagram';
    shell.setAttribute('role', 'img');
    shell.setAttribute('aria-label', 'Project flowchart');
    shell.append(diagram);
    code.parentElement?.replaceWith(shell);
  }

  collapseReadmeHeadings(container);

  return container.innerHTML;
}

export async function fetchRenderedReadme(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(new URL('./content/README.md', document.baseURI).href, { cache: 'no-store' });
  if (!response.ok) throw new Error(`README is unavailable (HTTP ${response.status}).`);
  return renderReadmeMarkdown(await response.text());
}
