let configured = false;
let mermaidPromise: Promise<(typeof import('mermaid'))['default']> | undefined;

async function configureMermaid(): Promise<(typeof import('mermaid'))['default']> {
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  const mermaid = await mermaidPromise;
  if (configured) return mermaid;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'Inter, Arial, sans-serif',
    flowchart: {
      curve: 'basis',
      htmlLabels: false,
      useMaxWidth: true,
    },
    themeVariables: {
      background: '#ffffff',
      primaryColor: '#dbf0ff',
      primaryTextColor: '#111111',
      primaryBorderColor: '#1170cf',
      secondaryColor: '#f7f7f7',
      secondaryTextColor: '#111111',
      secondaryBorderColor: '#545454',
      tertiaryColor: '#ffffff',
      tertiaryTextColor: '#111111',
      tertiaryBorderColor: '#adadad',
      lineColor: '#545454',
      textColor: '#111111',
      mainBkg: '#f7f7f7',
      nodeBorder: '#1170cf',
      clusterBkg: '#f7f7f7',
      clusterBorder: '#adadad',
      edgeLabelBackground: '#ffffff',
      fontFamily: 'Inter, Arial, sans-serif',
    },
  });
  configured = true;
  return mermaid;
}

export async function renderMermaidDiagrams(root: ParentNode): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-pending]')]
    .filter((node) => {
      let details = node.closest('details');
      while (details) {
        if (!details.open) return false;
        details = details.parentElement?.closest('details') ?? null;
      }
      return true;
    });
  if (!nodes.length) return;
  const mermaid = await configureMermaid();
  await document.fonts?.ready;
  await mermaid.run({ nodes, suppressErrors: true });
}
