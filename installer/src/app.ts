import certificateIcon from '@momentum-design/icons/dist/svg/certificate-regular.svg?raw';
import checkIcon from '@momentum-design/icons/dist/svg/check-circle-filled.svg?raw';
import cloudIcon from '@momentum-design/icons/dist/svg/cloud-download-regular.svg?raw';
import deviceIcon from '@momentum-design/icons/dist/svg/device-in-room-filled.svg?raw';
import settingsIcon from '@momentum-design/icons/dist/svg/settings-regular.svg?raw';
import warningIcon from '@momentum-design/icons/dist/svg/warning-filled.svg?raw';
import {
  configPathId,
  formatConfigPath,
  parseConfigDocument,
  patchConfigSource,
  redactConfig,
  setLockedInstallerValues,
} from './config-editor';
import { groupConfigLeaves, humanizeConfigForReview, humanizeConfigSegment, type ConfigGroup } from './config-presentation';
import {
  connectToCompanionDevice,
  listInstalledMacros,
  normalizeCompanionDeviceHost,
  normalizeSerial,
  validateCallbackCredentials,
  validateConnectedCompanionDevice,
  type CompanionDeviceCredentials,
  type CompanionDeviceXapi,
} from './device';
import { isLocalReviewHost } from './dev-review';
import {
  InitializationMonitor,
  installResources as installMacroResources,
  legacyMacros,
  type LogClassification,
} from './install';
import { validateManifest } from './manifest';
import { renderMermaidDiagrams } from './mermaid';
import {
  ParentRegistrationMonitor,
  createParentRegistrationRequest,
  sendParentRegistrationRequest,
} from './parent-registration';
import { discoverReleaseSources, loadSourceSnapshot } from './release-source';
import { fetchRenderedReadme } from './readme';
import {
  CONFIG_MACRO_FILE,
  GENERATED_STORAGE_MACRO,
  type ConfigDocument,
  type ConfigLeaf,
  type ConfigValue,
  type DeviceCompatibility,
  type InitializationOutcome,
  type InstallResource,
  type InstallationType,
  type InstalledMacro,
  type ParentRegistrationForm,
  type ParentRegistrationOutcome,
  type ParentRegistrationRequest,
  type ReleaseDiscovery,
  type ReleaseSource,
  type SourceSnapshot,
} from './types';

const STEPS = ['Introduction', 'Release', 'Connect', 'Configure', 'Installation Type', 'Review', 'Install', 'Complete Setup'];
const TEAM_ICON_URL = 'https://avatars.githubusercontent.com/u/159071680?s=200&v=4';
const TEAM_GITHUB_URL = 'https://github.com/ctg-tme';
const CISCO_SAMPLE_CODE_LICENSE_URL = 'https://developer.cisco.com/docs/licenses';

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withLeafValues(document: ConfigDocument, values: Map<string, ConfigValue>): ConfigValue {
  const root = deepCopy(document.value);
  for (const leaf of document.leaves) {
    const id = configPathId(leaf.path);
    const value = values.has(id) ? values.get(id)! : leaf.value;
    if (leaf.path.length === 0) return value;
    let target = root as Exclude<ConfigValue, null | string | number | boolean>;
    leaf.path.forEach((part, index) => {
      if (index === leaf.path.length - 1) {
        if (Array.isArray(target)) target[Number(part)] = value;
        else target[String(part)] = value;
        return;
      }
      target = (Array.isArray(target) ? target[Number(part)] : target[String(part)]) as Exclude<ConfigValue, null | string | number | boolean>;
    });
  }
  return root;
}

function selectedSource(discovery: ReleaseDiscovery | undefined, id: string): ReleaseSource | undefined {
  return discovery?.sources.find((source) => source.id === id);
}

export class InstallerApp {
  private step = 0;
  private readmeHtml = '';
  private readmeError = '';
  private readmeLoading = true;
  private discovery?: ReleaseDiscovery;
  private selectedSourceId = 'main';
  private betaAcknowledged = false;
  private busy = false;
  private error = '';
  private snapshot?: SourceSnapshot;
  private companionDevice?: CompanionDeviceXapi;
  private adminCredentials: CompanionDeviceCredentials = { host: '', username: '', password: '' };
  private expectedSerial = '';
  private compatibility?: DeviceCompatibility;
  private installed: InstalledMacro[] = [];
  private configDocument?: ConfigDocument;
  private configValues = new Map<string, ConfigValue>();
  private preparedResources: InstallResource[] = [];
  private activeCallConfirmed = false;
  private installationType?: InstallationType;
  private purgeLegacy = true;
  private monitor?: InitializationMonitor;
  private installProgress = '';
  private installOutcome?: InitializationOutcome;
  private installError = '';
  private macroLogs: Array<{ classification: LogClassification; message: string }> = [];
  private certificatePromptVisible = false;
  private completionHost = '';
  private parentRegistrationForm: ParentRegistrationForm = {
    host: '',
    serial: '',
    username: '',
    password: '',
    passwordConfirmation: '',
    allowOverwrite: false,
  };
  private parentRegistrationOutcome?: ParentRegistrationOutcome;
  private parentRegistrationMonitor?: ParentRegistrationMonitor;
  private parentRegistrationLogs: string[] = [];
  private parentRegistrationModalOpen = false;
  private readonly localReviewEnabled = isLocalReviewHost(window.location.hostname);
  private localReviewMode = false;

  constructor(private readonly root: HTMLElement) {}

  async initialize(): Promise<void> {
    this.render();
    const [discovery, readme] = await Promise.allSettled([
      discoverReleaseSources(),
      fetchRenderedReadme(),
    ]);
    if (discovery.status === 'fulfilled') {
      this.discovery = discovery.value;
      this.selectedSourceId = this.discovery.defaultSourceId;
    } else {
      this.discovery = {
        sources: [{
          id: 'main',
          label: 'Main Fork (Beta)',
          kind: 'main',
          resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/tree/main',
        }],
        defaultSourceId: 'main',
        unreachableReason: 'Source discovery failed.',
      };
    }
    if (readme.status === 'fulfilled') this.readmeHtml = readme.value;
    else this.readmeError = readme.reason instanceof Error ? readme.reason.message : String(readme.reason);
    this.readmeLoading = false;
    this.render();
  }

  private currentSource(): ReleaseSource | undefined {
    return selectedSource(this.discovery, this.selectedSourceId);
  }

  private render(): void {
    const pages = [
      this.renderIntroduction(),
      this.renderRelease(),
      this.renderConnect(),
      this.renderConfigure(),
      this.renderInstallationType(),
      this.renderReview(),
      this.renderInstall(),
      this.renderCompleteSetup(),
    ];
    const actions = this.renderStepActions();
    const year = new Date().getFullYear();
    this.root.innerHTML = `
      <div class="app-shell mds-core mds-theme-stable-lightWebex mds-typography">
        <aside class="rail">
          <a class="brand" href="./" aria-label="Custom Companion installer home">
            <img class="brand-avatar" src="${TEAM_ICON_URL}" alt="Collaboration TME team icon">
            <span><strong>Custom Companion</strong><small>Companion Device installer</small></span>
          </a>
          <nav aria-label="Installation progress">
            <ol class="step-list">
              ${STEPS.map((label, index) => `
                <li class="step ${index === this.step ? 'current' : ''} ${index < this.step ? 'complete' : ''}" ${index === this.step ? 'aria-current="step"' : ''}>
                  <span class="step-number">${index < this.step ? checkIcon : index + 1}</span>
                  <span>${label}</span>
                </li>`).join('')}
            </ol>
          </nav>
          ${this.renderLocalReviewTools()}
        </aside>
        <main class="workspace">
          <div class="workspace-scroll">
            <div class="workspace-inner">
              ${pages[this.step] ?? pages[0]}
            </div>
          </div>
          ${actions ? `<div class="workspace-actions">${actions}</div>` : ''}
          <footer class="site-footer">
            <span>© ${year} Cisco Systems, Inc. || Created by the Collaboration TME team</span>
            <span><a href="${CISCO_SAMPLE_CODE_LICENSE_URL}" target="_blank" rel="noopener noreferrer">Cisco Sample Code License</a> · Credentials remain in this browser session and are cleared when you disconnect.</span>
          </footer>
        </main>
        ${this.parentRegistrationModalOpen ? this.renderParentRegistrationModal() : ''}
      </div>`;
    this.bindEvents();
    this.bindReadmeEvents();
    void renderMermaidDiagrams(this.root);
  }

  private bindReadmeEvents(): void {
    for (const section of this.root.querySelectorAll<HTMLDetailsElement>('.readme-section')) {
      section.addEventListener('toggle', () => {
        if (section.open) void renderMermaidDiagrams(section);
      });
    }
    for (const anchor of this.root.querySelectorAll<HTMLAnchorElement>('.readme-content a[href^="#"]')) {
      anchor.addEventListener('click', () => {
        const id = decodeURIComponent((anchor.getAttribute('href') || '').slice(1));
        let details = document.getElementById(id)?.closest('details');
        while (details) {
          details.open = true;
          details = details.parentElement?.closest('details') ?? null;
        }
      });
    }
  }

  private renderLocalReviewTools(): string {
    if (!this.localReviewEnabled) return '';
    return `
      <section class="dev-tools" aria-label="Local review tools">
        <span class="dev-tools-label"><strong>Local review</strong><small>${this.localReviewMode ? 'Review mode active · device changes disabled' : 'Available only on localhost'}</small></span>
        <label><span>Preview page</span><select id="dev-step-select" ${this.busy ? 'disabled' : ''}>${STEPS.map((label, index) => `<option value="${index}" ${index === this.step ? 'selected' : ''}>${index + 1}. ${label}</option>`).join('')}</select></label>
        <button class="dev-reset" id="dev-reset" type="button">Reset live workflow</button>
      </section>`;
  }

  private renderStepActions(): string {
    const source = this.currentSource();
    if (this.step === 0) {
      return `<div class="actions intro-actions"><button class="button primary" id="start-installer" ${this.readmeLoading ? 'disabled' : ''}>Start installation</button></div>`;
    }
    if (this.step === 1) {
      const disabled = !this.discovery || this.busy || (source?.kind === 'main' && !this.betaAcknowledged);
      return `<div class="actions split"><button class="button ghost" id="back-introduction">Back to introduction</button><button class="button primary" id="source-continue" ${disabled ? 'disabled' : ''}>${this.busy ? '<span class="spinner inverse"></span>Preparing source…' : 'Continue'}</button></div>`;
    }
    if (this.step === 2) {
      const label = this.localReviewMode ? 'Connect disabled in local review' : this.busy ? '<span class="spinner inverse"></span>Connecting…' : 'Connect and verify';
      return `<div class="actions split"><button class="button ghost" id="back-release">Back</button><button class="button primary" id="connect-companion-device" ${this.busy || this.localReviewMode ? 'disabled' : ''}>${label}</button></div>`;
    }
    if (this.step === 3) {
      const primary = this.localReviewMode
        ? '<button class="button primary" id="dev-preview-installation-type">Preview installation type</button>'
        : `<button class="button primary" id="config-continue" ${this.busy ? 'disabled' : ''}>${this.busy ? '<span class="spinner inverse"></span>Validating callback account…' : 'Choose installation type'}</button>`;
      return `<div class="actions split"><button class="button ghost" id="disconnect-config">${this.localReviewMode ? 'Exit local review' : 'Disconnect'}</button>${primary}</div>`;
    }
    if (this.step === 4) {
      return `<div class="actions split"><button class="button ghost" id="back-config">Back to configuration</button><button class="button primary" id="review-installation" ${this.installationType ? '' : 'disabled'}>Review installation</button></div>`;
    }
    if (this.step === 5) {
      return `<div class="actions split"><button class="button ghost" id="back-installation-type">Back to installation type</button><button class="button primary danger-button" id="begin-install" ${this.localReviewMode ? 'disabled' : ''}>${this.localReviewMode ? 'Install disabled in local review' : 'Install on Companion Device'}</button></div>`;
    }
    if (this.step === 7) {
      return `<div class="actions split"><button class="button ghost" id="finish-setup" ${this.busy ? 'disabled' : ''}>Finish — install another Companion Device</button><button class="button primary" id="add-parent" ${this.parentRegistrationModalOpen || this.busy ? 'disabled' : ''}>Add Parent</button></div>`;
    }
    if (this.localReviewMode) {
      return '<div class="actions centered"><button class="button primary" id="dev-preview-complete">Preview complete setup</button></div>';
    }
    const outcome = this.installOutcome;
    const ready = outcome?.kind === 'ready' || outcome?.kind === 'ready-with-warnings';
    const installActions = [
      ready ? '<button class="button primary" id="finish-install">Continue to device setup</button>' : '',
      outcome?.kind === 'timeout' ? '<button class="button primary" id="keep-waiting">Keep waiting</button><button class="button secondary" id="restart-runtime">Restart macro runtime</button>' : '',
      outcome?.kind === 'failed' || this.installError || outcome?.kind === 'timeout' ? '<button class="button ghost" id="disconnect-install">Disconnect</button>' : '',
    ].join('');
    return installActions ? `<div class="actions centered">${installActions}</div>` : '';
  }

  private pageHeader(eyebrow: string, title: string, body: string): string {
    return `<header class="page-header"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></header>`;
  }

  private errorNotice(): string {
    return this.error ? `<div class="notice error" role="alert"><span>${warningIcon}</span><div><strong>Unable to continue</strong><p>${escapeHtml(this.error)}</p></div></div>` : '';
  }

  private renderIntroduction(): string {
    return `
      ${this.pageHeader('Custom Companion 2026', 'Install the Custom Companion Macro', 'Review the project directly from its current README, then begin a guided release, identity, compatibility, configuration, and installation workflow.')}
      <section class="intro-team">
        <div class="team-lockup">
          <img src="${TEAM_ICON_URL}" alt="Collaboration TME team icon">
          <span><small>Created by</small><a href="${TEAM_GITHUB_URL}" target="_blank" rel="noopener noreferrer">Collaboration TME team</a></span>
        </div>
      </section>
      <section class="readme-shell" aria-labelledby="project-readme-title">
        <header><div><span class="eyebrow">Live project documentation</span><h2 id="project-readme-title">README.md</h2></div><a href="https://github.com/ctg-tme/Custom_Companion_2026/blob/main/README.md" target="_blank" rel="noopener noreferrer">View source on GitHub</a></header>
        ${this.readmeLoading ? '<div class="loading-row readme-loading"><span class="spinner"></span>Rendering the current README…</div>' : ''}
        ${this.readmeError ? `<div class="notice error readme-error" role="alert"><span>${warningIcon}</span><div><strong>README unavailable</strong><p>${escapeHtml(this.readmeError)}</p></div></div>` : ''}
        ${this.readmeHtml ? `<article class="readme-content">${this.readmeHtml}</article>` : ''}
      </section>`;
  }

  private renderRelease(): string {
    const source = this.currentSource();
    const loading = !this.discovery;
    return `
      ${this.pageHeader('Step 2 of 8', 'Choose an installation source', 'Published releases are the safest choice. Main Fork is available as a versioned Beta snapshot of this Pages build.')}
      ${this.errorNotice()}
      <section class="panel source-panel">
        <div class="panel-heading"><span class="heading-icon">${cloudIcon}</span><div><h2>Release channel</h2><p>Stable releases appear first, followed by Preview builds and the versioned Main Fork (Beta).</p></div></div>
        ${loading ? '<div class="loading-row"><span class="spinner"></span>Checking GitHub releases…</div>' : `
          <label class="field"><span>Installation source</span>
            <select id="source-select" ${this.busy ? 'disabled' : ''}>
              ${this.discovery?.unreachableReason ? `<option disabled>Releases unreachable — repository may be private</option>` : ''}
              ${this.discovery?.sources.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === this.selectedSourceId ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
            </select>
          </label>
          ${source ? `<a class="resource-link" href="${escapeHtml(source.resourceUrl)}" target="_blank" rel="noopener noreferrer"><span>${cloudIcon}</span><span><strong>View ${escapeHtml(source.label)}</strong><small>${escapeHtml(source.resourceUrl)}</small></span></a>` : ''}
          ${this.discovery?.unreachableReason ? `<div class="notice warning"><span>${warningIcon}</span><div><strong>Published releases could not be listed</strong><p>${escapeHtml(this.discovery.unreachableReason)} Main Fork (Beta) remains available from this Pages build.</p></div></div>` : ''}
          ${source?.kind === 'main' ? `
            <div class="beta-consent">
              <label class="check-row"><input id="beta-ack" type="checkbox" ${this.betaAcknowledged ? 'checked' : ''}><span><strong>I understand Main Fork is a Beta source</strong><small>Version ${escapeHtml(source.version ?? 'unavailable')} may be incomplete and can change with the next Pages deployment.</small></span></label>
            </div>` : ''}
        `}
      </section>`;
  }

  private renderConnect(): string {
    return `
      ${this.pageHeader('Step 3 of 8', 'Connect to the Companion Device', 'Sign in with the Companion Device administrator account used only for installation. If certificate trust blocks sign-in, a recovery link appears after the failed attempt.')}
      ${this.errorNotice()}
      <section class="panel connect-panel">
        <div class="panel-heading"><span class="heading-icon">${deviceIcon}</span><div><h2>Companion Device connection</h2><p>Enter the device identity and administrator credentials. The serial comparison confirms the intended device before installation.</p></div></div>
        <div class="connection-fields">
          <label class="field"><span>Companion Device host address</span><input id="companion-device-host" inputmode="url" placeholder="companion.example.com or 10.0.0.120" value="${escapeHtml(this.adminCredentials.host)}" autocomplete="off"></label>
          <label class="field"><span>Companion Device Serial</span><input id="expected-serial" value="${escapeHtml(this.expectedSerial)}" autocomplete="off" spellcheck="false"><small>The serial is used for Device Verification prior to Installation</small></label>
          <label class="field"><span>Companion Device Username</span><input id="admin-username" value="${escapeHtml(this.adminCredentials.username)}" autocomplete="username"></label>
          <label class="field"><span>Companion Device Password</span><input id="admin-password" type="password" value="${escapeHtml(this.adminCredentials.password)}" autocomplete="current-password"></label>
        </div>
        ${this.certificatePromptVisible ? `<div class="certificate-recovery"><span>${certificateIcon}</span><div><strong>Certificate trust may be blocking sign-in</strong><p>Open the Companion Device address, accept its self-signed certificate warning, then try connecting again.</p><button class="button secondary" id="trust-certificate" type="button">Open Companion Device certificate page</button></div></div>` : ''}
      </section>`;
  }

  private renderCompatibility(): string {
    if (!this.compatibility || !this.snapshot) return '';
    return `<div class="verification-grid">
      <div><span>${checkIcon}</span><small>Serial number</small><strong>Match confirmed</strong></div>
      <div><span>${checkIcon}</span><small>Product platform</small><strong>${escapeHtml(this.compatibility.productPlatform)}</strong></div>
      <div><span>${checkIcon}</span><small>RoomOS</small><strong>${escapeHtml(this.compatibility.roomOsVersion)}</strong><em>Minimum ${escapeHtml(this.snapshot.manifest.MinimumRoomOSVersion)}</em></div>
    </div>`;
  }

  private renderConfigField(leaf: ConfigLeaf): string {
    const id = configPathId(leaf.path);
    const value = this.configValues.get(id) ?? leaf.value;
    const key = String(leaf.path.at(-1) ?? 'config');
    const label = humanizeConfigSegment(leaf.path.at(-1) ?? 'Configuration');
    const password = /(password|secret|token)/i.test(key);
    const locked = Boolean(leaf.lockedReason);
    let control: string;
    if (typeof value === 'boolean') {
      control = `<label class="toggle"><input data-config-id="${escapeHtml(id)}" data-value-type="boolean" type="checkbox" ${value ? 'checked' : ''} ${locked ? 'disabled' : ''}><span></span><em>${value ? 'Enabled' : 'Disabled'}</em></label>`;
    } else if (typeof value === 'number') {
      control = `<input data-config-id="${escapeHtml(id)}" data-value-type="number" type="number" value="${escapeHtml(value)}" ${locked ? 'readonly' : ''}>`;
    } else if (value === null || typeof value === 'object') {
      control = `<textarea data-config-id="${escapeHtml(id)}" data-value-type="json" rows="3" ${locked ? 'readonly' : ''}>${escapeHtml(JSON.stringify(value, null, 2))}</textarea>`;
    } else {
      control = `<input data-config-id="${escapeHtml(id)}" data-value-type="string" type="${password ? 'password' : 'text'}" value="${escapeHtml(value)}" ${locked ? 'readonly' : ''} ${password ? 'autocomplete="new-password"' : ''}>`;
    }
    const note = leaf.lockedReason === 'version'
      ? 'Source-controlled version — shown for reference and never edited.'
      : leaf.lockedReason === 'companion-device-host'
        ? 'Filled from the Companion Device address used during sign-in.'
        : '';
    return `<label class="config-field"><span>${escapeHtml(label)}${locked ? '<mark>Installer controlled</mark>' : ''}</span>${control}${note ? `<small>${escapeHtml(note)}</small>` : ''}</label>`;
  }

  private renderConfigGroup(group: ConfigGroup, depth: number): string {
    const headingLevel = Math.min(2 + depth, 6);
    const fields = group.leaves.length
      ? `<div class="config-grid">${group.leaves.map((leaf) => this.renderConfigField(leaf)).join('')}</div>`
      : '';
    return `
      <section class="config-section config-depth-${Math.min(depth, 4)}">
        <header class="config-section-header"><h${headingLevel}>${escapeHtml(group.label)}</h${headingLevel}>${group.leaves.length ? `<small>${group.leaves.length} setting${group.leaves.length === 1 ? '' : 's'}</small>` : ''}</header>
        ${fields}
        ${group.children.map((child) => this.renderConfigGroup(child, depth + 1)).join('')}
      </section>`;
  }

  private renderConfigGroups(): string {
    if (!this.configDocument) return '';
    const tree = groupConfigLeaves(this.configDocument.leaves);
    const groups = [
      ...(tree.leaves.length ? [{ ...tree, children: [] }] : []),
      ...tree.children,
    ];
    return groups.map((group) => this.renderConfigGroup(group, 0)).join('');
  }

  private renderConfigure(): string {
    return `
      ${this.pageHeader('Step 4 of 8', 'Configure the Companion Device runtime', 'Every value is generated from the selected Config macro. Per-install edits remain in memory and never change repository files.')}
      ${this.errorNotice()}
      ${this.renderCompatibility()}
      ${this.compatibility?.deskSeriesWarning ? `<div class="notice warning"><span>${warningIcon}</span><div><strong>Desk Series is not recommended</strong><p>This platform is available for testing and special use cases.</p></div></div>` : ''}
      ${this.compatibility?.activeCalls ? `<div class="notice danger"><span>${warningIcon}</span><div><strong>Active call detected</strong><p>Installing and restarting macros during a call may change Companion Device behavior.</p><label class="check-row compact"><input id="active-call-confirm" type="checkbox" ${this.activeCallConfirmed ? 'checked' : ''}><span>I understand and want to continue during the active call.</span></label></div></div>` : ''}
      <section class="panel callback-panel">
        <div class="panel-heading"><span class="heading-icon">${settingsIcon}</span><div><h2>Companion Device callback account</h2><p>This existing local Companion Device account is written into Config for runtime callbacks. <strong>custom-companion</strong> is the suggested username. A distinct account is encouraged for clearer audit logs, though it may be the same as the installer sign-in.</p></div></div>
        <label class="check-row"><input id="reuse-admin" type="checkbox"><span><strong>Use installer sign-in for callback authentication</strong><small>This is allowed, but a distinct account makes audit activity easier to identify.</small></span></label>
      </section>
      <section class="config-editor" aria-label="Dynamic configuration editor">${this.renderConfigGroups()}</section>`;
  }

  private renderInstallationType(): string {
    return `
      ${this.pageHeader('Step 5 of 8', 'Choose an installation type', 'Choose whether the installer should preserve existing Custom Companion state or begin with a clean generated storage file.')}
      ${this.errorNotice()}
      <section class="installation-type-grid" aria-label="Installation type">
        <label class="installation-type-card ${this.installationType === 'standard' ? 'selected' : ''}">
          <input type="radio" name="installation-type" value="standard" ${this.installationType === 'standard' ? 'checked' : ''}>
          <span class="installation-type-copy">
            <small>Standard installation</small>
            <strong>Install Custom Companion 2026 Macros</strong>
            <em>Preserves <code>${GENERATED_STORAGE_MACRO}</code> and its existing Companion Device-local Custom Companion state.</em>
          </span>
        </label>
        <label class="installation-type-card clean ${this.installationType === 'clean' ? 'selected' : ''}">
          <input type="radio" name="installation-type" value="clean" ${this.installationType === 'clean' ? 'checked' : ''}>
          <span class="installation-type-copy">
            <small>Clean installation</small>
            <strong>Purge ${GENERATED_STORAGE_MACRO} and Install Custom Companion 2026 Macros</strong>
            <em>Deletes saved Parent Room Devices, Pending Deregistration cleanup records, the active Parent Room Device selection, PIN Mode state, and captured Standalone Paired Environment and standby preferences before installation.</em>
          </span>
        </label>
      </section>
      ${this.installationType === 'clean' ? `<div class="notice warning"><span>${warningIcon}</span><div><strong>Clean installation permanently removes stored state</strong><p>The generated storage macro is not part of the Release Manifest and cannot be restored by this forward-only installer.</p></div></div>` : ''}`;
  }

  private currentLegacy(): InstalledMacro[] {
    return legacyMacros(this.installed, this.preparedResources.length ? this.preparedResources : this.snapshot?.resources ?? []);
  }

  private renderReview(): string {
    const source = this.snapshot?.source;
    const legacy = this.currentLegacy();
    const cleanInstallation = this.installationType === 'clean';
    const storageInstalled = this.installed.some((macro) => macro.name === GENERATED_STORAGE_MACRO);
    const config = this.configDocument
      ? humanizeConfigForReview(redactConfig(withLeafValues(this.configDocument, this.configValues)))
      : {};
    return `
      ${this.pageHeader('Step 6 of 8', 'Review before installing', 'All source files have passed preflight. The next action begins forward-only changes on the connected Companion Device.')}
      ${this.errorNotice()}
      <section class="summary-grid install-summary">
        <div class="summary-item"><small>Installation source</small><strong>${escapeHtml(source?.label ?? '')}</strong><span title="${escapeHtml(this.snapshot?.commitSha ?? '')}">${escapeHtml((this.snapshot?.commitSha ?? '').slice(0, 12))}</span></div>
        <div class="summary-item"><small>Target Companion Device</small><strong>${escapeHtml(this.adminCredentials.host)}</strong><span>Serial match confirmed</span></div>
        <div class="summary-item"><small>Files ready</small><strong>${this.preparedResources.length}</strong><span>${this.snapshot?.manifest.Files.length ?? 0} project · ${this.snapshot?.manifest.ExternalDependencies.length ?? 0} external</span></div>
        <div class="summary-item"><small>Installation type</small><strong>${cleanInstallation ? 'Clean installation' : 'Standard installation'}</strong><span>${cleanInstallation ? (storageInstalled ? `${GENERATED_STORAGE_MACRO} will be removed` : 'No generated storage macro was found') : 'Generated storage will be preserved'}</span></div>
      </section>
      <section class="panel legacy-panel">
        <div class="panel-heading"><span class="heading-icon warning-color">${warningIcon}</span><div><h2>Legacy project macros</h2><p>These are installed Custom-Campanion files that are not part of the selected release.</p></div></div>
        ${legacy.length ? `<ul class="file-list">${legacy.map((macro) => `<li><code>${escapeHtml(macro.name)}</code><span>Legacy</span></li>`).join('')}</ul>
          <label class="check-row purge"><input id="purge-legacy" type="checkbox" ${this.purgeLegacy ? 'checked' : ''}><span><strong>Purge legacy files</strong><small>Checked by default. Uncheck to retain these files in an inactive state.</small></span></label>` : '<p class="empty-state">No legacy project macros were found. Generated storage is governed only by the selected installation type; unrelated macros remain outside this installer’s scope.</p>'}
      </section>
      <section class="config-preview" aria-labelledby="config-preview-title">
        <header><div><h2 id="config-preview-title">Configuration summary</h2><p>Every generated setting is shown with human-facing labels. Credential values remain masked in this review.</p></div></header>
        <pre><code>${escapeHtml(JSON.stringify(config, null, 2))}</code></pre>
      </section>
      <div class="notice danger"><span>${warningIcon}</span><div><strong>No automatic rollback</strong><p>${cleanInstallation ? `${GENERATED_STORAGE_MACRO} and its stored Companion Device state will be permanently removed before matching macros are overwritten.` : 'Matching macros will be overwritten while generated Companion Device storage is preserved.'} Installation continues forward and reports the macro runtime result.</p></div></div>`;
  }

  private renderInstall(): string {
    const outcome = this.installOutcome;
    const ready = outcome?.kind === 'ready' || outcome?.kind === 'ready-with-warnings';
    return `
      ${this.pageHeader('Step 7 of 8', ready ? 'Companion Device installation ready' : 'Installing and verifying', ready ? 'The Companion Device macros initialized successfully. Complete setup next, then optionally add Parent Room Devices here or on the Companion Device.' : 'The installer is listening to Event Macros Log for runtime errors and the initialization-complete message.')}
      ${this.installError ? `<div class="notice error"><span>${warningIcon}</span><div><strong>Installation stopped</strong><p>${escapeHtml(this.installError)}</p></div></div>` : ''}
      <section class="panel install-status">
        <div class="status-orb ${ready ? 'ready' : outcome?.kind === 'failed' ? 'failed' : ''}">${ready ? checkIcon : outcome?.kind === 'failed' ? warningIcon : '<span class="spinner large"></span>'}</div>
        <h2>${ready ? (outcome?.kind === 'ready-with-warnings' ? 'Installed with warnings' : 'Macros installed and ready') : outcome?.kind === 'timeout' ? 'Initialization not confirmed' : outcome?.kind === 'failed' || this.installError ? 'Initialization failed' : 'Installation in progress'}</h2>
        <p>${ready ? 'The Custom Companion runtime is active on this Companion Device.' : outcome?.kind === 'timeout' ? 'No success or failure message arrived within two minutes. The log subscription remains active.' : this.installProgress || 'Preparing installation…'}</p>
        ${outcome?.kind === 'ready-with-warnings' ? `<div class="notice warning inline"><span>${warningIcon}</span><div><strong>${outcome.warnings.length} runtime error${outcome.warnings.length === 1 ? '' : 's'} observed</strong><p>Initialization completed, but review the log entries below.</p></div></div>` : ''}
      </section>
      ${this.macroLogs.length ? `<details class="log-panel" open><summary>Macro event log <span>${this.macroLogs.length}</span></summary><ol>${this.macroLogs.slice(-50).map((entry) => `<li class="${entry.classification}"><span>${escapeHtml(entry.classification)}</span><code>${escapeHtml(entry.message)}</code></li>`).join('')}</ol></details>` : ''}
      ${ready ? `<div class="modal-backdrop"><div class="success-dialog" role="dialog" aria-modal="true" aria-labelledby="ready-title"><button class="dialog-close" id="close-ready" aria-label="Continue to Complete Setup">Close</button><span class="dialog-icon">${checkIcon}</span><h2 id="ready-title">Macros installed and ready</h2><p>Custom Companion initialized on the Companion Device. Parent Room Device registration is optional and remains available from Complete Setup.</p><button class="button primary" id="acknowledge-ready">Continue to Complete Setup</button></div></div>` : ''}`;
  }

  private renderParentRegistrationModal(): string {
    const form = this.parentRegistrationForm;
    const outcome = this.parentRegistrationOutcome;
    const disabled = this.busy || this.localReviewMode ? 'disabled' : '';
    const canClose = !this.busy && outcome?.kind !== 'timeout';
    const outcomeNotice = outcome?.kind === 'succeeded'
      ? `<div class="notice success"><span>${checkIcon}</span><div><strong>Parent Room Device registered</strong><p>The Companion Device confirmed the Parent Room Device installation and saved the registration.</p></div></div>`
      : outcome?.kind === 'failed'
        ? `<div class="notice error"><span>${warningIcon}</span><div><strong>Parent Room Device registration failed</strong><p>${escapeHtml(this.parentRegistrationResultText(outcome.message))}</p></div></div>`
        : outcome?.kind === 'timeout'
          ? `<div class="notice warning"><span>${warningIcon}</span><div><strong>Registration has not been confirmed</strong><p>The Companion Device is still connected and the log subscription remains active. Keep waiting for its final result.</p></div></div>`
          : '';
    const actions = outcome?.kind === 'succeeded'
      ? '<div class="dialog-actions"><button class="button ghost" id="finish-parent-registration" type="button">Close</button><button class="button primary" id="register-another-parent" type="button">Add another Parent</button></div>'
      : outcome?.kind === 'timeout'
        ? `<div class="dialog-actions"><button class="button primary" id="keep-waiting-parent" type="button" ${this.busy ? 'disabled' : ''}>${this.busy ? '<span class="spinner inverse"></span>Waiting…' : 'Keep waiting'}</button></div>`
        : `<div class="dialog-actions"><button class="button ghost" id="cancel-parent-registration" type="button" ${canClose ? '' : 'disabled'}>Cancel</button><button class="button primary" id="register-parent" type="button" ${disabled}>${this.busy ? '<span class="spinner inverse"></span>Registering…' : 'Register Parent Room Device'}</button></div>`;
    return `
      <div class="modal-backdrop parent-registration-modal">
        <section class="parent-registration-dialog" role="dialog" aria-modal="true" aria-labelledby="parent-registration-title">
          <button class="dialog-close" id="close-parent-registration" type="button" aria-label="Close Parent Room Device registration" ${canClose ? '' : 'disabled'}>Close</button>
          <div class="panel-heading"><span class="heading-icon">${deviceIcon}</span><div><span class="eyebrow">Optional setup</span><h2 id="parent-registration-title">Add Parent Room Device</h2><p>Use the signed-in Device Administrator session to start the existing Parent Room Registration workflow. Nothing is shown in the Companion Device in-room interface.</p></div></div>
          ${this.errorNotice()}
          ${outcomeNotice}
          <form id="parent-registration-form" class="parent-registration-form">
          <div class="connection-fields">
            <label class="field"><span>Parent Room Device host address</span><input id="parent-device-host" inputmode="url" placeholder="parent.example.com or 10.0.0.121" value="${escapeHtml(form.host)}" autocomplete="off" ${disabled}></label>
            <label class="field"><span>Parent Room Device Serial</span><input id="parent-device-serial" value="${escapeHtml(form.serial)}" autocomplete="off" spellcheck="false" ${disabled}><small>The Companion Device uses this value to verify the Parent Room Device before installation.</small></label>
            <label class="field"><span>Parent Room Device Username</span><input id="parent-device-username" value="${escapeHtml(form.username)}" autocomplete="username" ${disabled}></label>
            <label class="field"><span>Parent Room Device Password</span><input id="parent-device-password" type="password" value="${escapeHtml(form.password)}" autocomplete="new-password" ${disabled}></label>
            <label class="field"><span>Confirm Parent Room Device Password</span><input id="parent-device-password-confirmation" type="password" value="${escapeHtml(form.passwordConfirmation)}" autocomplete="new-password" ${disabled}></label>
          </div>
          <label class="check-row replacement-ack"><input id="parent-device-overwrite" type="checkbox" ${form.allowOverwrite ? 'checked' : ''} ${disabled}><span><strong>Allow replacement of an existing Parent Room Registration</strong><small>Required only when the verified Parent Room Device is already registered or has a Pending Deregistration. This makes the new registration the current intent.</small></span></label>
          </form>
          ${this.parentRegistrationLogs.length ? `<details class="log-panel" open><summary>Parent registration activity <span>${this.parentRegistrationLogs.length}</span></summary><ol>${this.parentRegistrationLogs.map((message) => `<li class="info"><span>status</span><code>${escapeHtml(message)}</code></li>`).join('')}</ol></details>` : ''}
          ${actions}
        </section>
      </div>`;
  }

  private renderCompleteSetup(): string {
    const host = this.completionHost || this.adminCredentials.host;
    return `
      ${this.pageHeader('Step 8 of 8', 'Complete setup on the Companion Device', 'The Custom Companion Macro is installed. Adding Parent Room Devices here is optional; the Companion Device interface remains available too.')}
      <section class="panel complete-setup-panel">
        <span class="completion-icon">${checkIcon}</span>
        <div>
          <h2>Continue on ${escapeHtml(host || 'the Companion Device')}</h2>
          <p>This authenticated installer session remains connected while you are on this page. Select <strong>Add Parent</strong> to register one or more Parent Room Devices here, or complete registration later from the Companion Device interface.</p>
          <ol class="completion-steps">
            <li><strong>Add Parent Room Devices (optional)</strong><span>Use Add Parent as often as needed; each registration is independently verified and confirmed.</span></li>
            <li><strong>Use the Companion Device interface</strong><span>You can instead add or update Parent Room Devices from the on-device configuration experience.</span></li>
            <li><strong>Finish when ready</strong><span>Finish disconnects this installer session before you move to another Companion Device.</span></li>
          </ol>
        </div>
      </section>`;
  }

  private bindEvents(): void {
    this.byId('dev-step-select')?.addEventListener('change', (event) => {
      void this.navigateLocalReview(Number((event.target as HTMLSelectElement).value));
    });
    this.byId('dev-reset')?.addEventListener('click', () => this.reset());
    this.byId('dev-preview-installation-type')?.addEventListener('click', () => void this.navigateLocalReview(4));
    this.byId('dev-preview-complete')?.addEventListener('click', () => void this.navigateLocalReview(7));
    this.byId('start-installer')?.addEventListener('click', () => { this.step = 1; this.error = ''; this.render(); });
    this.byId('back-introduction')?.addEventListener('click', () => { this.step = 0; this.error = ''; this.render(); });
    this.byId('source-select')?.addEventListener('change', (event) => {
      this.selectedSourceId = (event.target as HTMLSelectElement).value;
      this.betaAcknowledged = false;
      this.error = '';
      this.render();
    });
    this.byId('beta-ack')?.addEventListener('change', (event) => {
      this.betaAcknowledged = (event.target as HTMLInputElement).checked;
      this.render();
    });
    this.byId('source-continue')?.addEventListener('click', () => {
      if (this.localReviewMode) void this.navigateLocalReview(2);
      else void this.prepareSource();
    });
    this.byId('back-release')?.addEventListener('click', () => { this.step = 1; this.error = ''; this.render(); });
    this.byId('trust-certificate')?.addEventListener('click', () => this.openCertificate());
    this.byId('connect-companion-device')?.addEventListener('click', () => void this.connectCompanionDevice());
    this.byId('reuse-admin')?.addEventListener('change', (event) => this.reuseAdminCredentials((event.target as HTMLInputElement).checked));
    this.byId('config-continue')?.addEventListener('click', () => void this.validateConfiguration());
    this.byId('disconnect-config')?.addEventListener('click', () => this.reset());
    this.byId('back-config')?.addEventListener('click', () => { this.step = 3; this.error = ''; this.render(); });
    for (const control of this.root.querySelectorAll<HTMLInputElement>('input[name="installation-type"]')) {
      control.addEventListener('change', () => {
        if (control.checked && (control.value === 'standard' || control.value === 'clean')) {
          this.installationType = control.value;
          this.error = '';
          this.render();
        }
      });
    }
    this.byId('review-installation')?.addEventListener('click', () => {
      if (!this.installationType) return;
      this.step = 5;
      this.error = '';
      this.render();
    });
    this.byId('back-installation-type')?.addEventListener('click', () => {
      const purgeControl = this.byId('purge-legacy') as HTMLInputElement | null;
      this.purgeLegacy = purgeControl?.checked ?? this.purgeLegacy;
      this.step = 4;
      this.error = '';
      this.render();
    });
    this.byId('begin-install')?.addEventListener('click', () => void this.beginInstall());
    this.byId('finish-install')?.addEventListener('click', () => this.continueToCompleteSetup());
    this.byId('acknowledge-ready')?.addEventListener('click', () => this.continueToCompleteSetup());
    this.byId('close-ready')?.addEventListener('click', () => this.continueToCompleteSetup());
    this.byId('add-parent')?.addEventListener('click', () => this.openParentRegistration());
    this.byId('close-parent-registration')?.addEventListener('click', () => this.closeParentRegistration());
    this.byId('cancel-parent-registration')?.addEventListener('click', () => this.closeParentRegistration());
    this.byId('finish-parent-registration')?.addEventListener('click', () => this.closeParentRegistration());
    this.byId('parent-registration-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.beginParentRegistration();
    });
    this.byId('register-parent')?.addEventListener('click', () => void this.beginParentRegistration());
    this.byId('keep-waiting-parent')?.addEventListener('click', () => void this.waitForParentRegistration());
    this.byId('register-another-parent')?.addEventListener('click', () => this.resetParentRegistrationForm());
    this.byId('finish-setup')?.addEventListener('click', () => this.reset());
    this.byId('disconnect-install')?.addEventListener('click', () => this.reset());
    this.byId('keep-waiting')?.addEventListener('click', () => void this.waitForInitialization());
    this.byId('restart-runtime')?.addEventListener('click', () => void this.restartRuntime());
  }

  private byId(id: string): HTMLElement | null {
    return this.root.querySelector(`#${id}`);
  }

  private async navigateLocalReview(targetStep: number): Promise<void> {
    if (!this.localReviewEnabled || !Number.isInteger(targetStep) || targetStep < 0 || targetStep >= STEPS.length) return;
    this.localReviewMode = true;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      if (targetStep >= 2) await this.ensureLocalReviewState();
      this.step = targetStep;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async ensureLocalReviewState(): Promise<void> {
    if (!this.snapshot || !this.configDocument) {
      const [manifestResponse, configResponse] = await Promise.all([
        fetch(new URL('./main/manifest.json', document.baseURI), { cache: 'no-store' }),
        fetch(new URL(`./main/${CONFIG_MACRO_FILE}`, document.baseURI), { cache: 'no-store' }),
      ]);
      if (!manifestResponse.ok) throw new Error(`Local review manifest is unavailable (HTTP ${manifestResponse.status}).`);
      if (!configResponse.ok) throw new Error(`Local review Config macro is unavailable (HTTP ${configResponse.status}).`);
      const manifest = validateManifest(await manifestResponse.json());
      const configSource = await configResponse.text();
      const source: ReleaseSource = {
        id: 'local-review',
        label: 'Local review · Main Fork (Beta)',
        kind: 'main',
        resourceUrl: 'https://github.com/ctg-tme/Custom_Companion_2026/tree/main',
        version: this.currentSource()?.version,
      };
      const projectResources: InstallResource[] = manifest.Files.map((fileName) => ({
        macroName: fileName.replace(/\.js$/, ''),
        fileName,
        content: fileName === CONFIG_MACRO_FILE ? configSource : `// Local review placeholder for ${fileName}`,
        kind: 'project',
      }));
      const externalResources: InstallResource[] = manifest.ExternalDependencies.map((dependency) => ({
        macroName: dependency.Name,
        fileName: new URL(dependency.RawUrl).pathname.split('/').pop() || `${dependency.Name}.js`,
        content: `// Local review placeholder for ${dependency.Name}`,
        kind: 'external',
      }));
      this.snapshot = {
        source,
        commitSha: 'local-review',
        manifest,
        resources: [...projectResources, ...externalResources],
      };
      this.configDocument = parseConfigDocument(configSource);
    }

    this.adminCredentials = { host: 'review-companion-device.local', username: 'installer-review', password: 'review-only' };
    this.expectedSerial = 'LOCAL-REVIEW-SERIAL';
    this.compatibility = {
      roomOsVersion: this.snapshot.manifest.MinimumRoomOSVersion,
      productPlatform: 'Board Pro G2',
      serialMatches: true,
      roomOsSupported: true,
      productSupported: true,
      deskSeriesWarning: false,
      activeCalls: 0,
    };
    this.configValues = new Map(this.configDocument.leaves.map((leaf) => [configPathId(leaf.path), leaf.value]));
    this.configValues = setLockedInstallerValues(this.configDocument, this.configValues, this.adminCredentials.host);
    for (const leaf of this.configDocument.leaves) {
      const path = formatConfigPath(leaf.path);
      if (path === 'CompanionBoardInformation.username') this.configValues.set(configPathId(leaf.path), 'custom-companion');
      if (path === 'CompanionBoardInformation.password') this.configValues.set(configPathId(leaf.path), 'review-only');
    }
    this.preparedResources = this.snapshot.resources.map((resource) => ({ ...resource }));
    if (!this.installed.length) {
      this.installed = [
        { name: GENERATED_STORAGE_MACRO, active: false },
        { name: 'Custom-Campanion_Legacy_2026', active: false },
      ];
    }
    this.installationType ??= 'standard';
    this.installProgress = 'Local review mode · no device changes will be made.';
  }

  private async prepareSource(): Promise<void> {
    const source = this.currentSource();
    if (!source) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      this.snapshot = await loadSourceSnapshot(source);
      const configResource = this.snapshot.resources.find((resource) => resource.fileName === CONFIG_MACRO_FILE);
      if (!configResource) throw new Error(`The source does not include ${CONFIG_MACRO_FILE}.`);
      this.configDocument = parseConfigDocument(configResource.content);
      this.step = 2;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private captureConnectFields(): void {
    this.adminCredentials = {
      host: (this.byId('companion-device-host') as HTMLInputElement | null)?.value ?? '',
      username: (this.byId('admin-username') as HTMLInputElement | null)?.value ?? '',
      password: (this.byId('admin-password') as HTMLInputElement | null)?.value ?? '',
    };
    this.expectedSerial = (this.byId('expected-serial') as HTMLInputElement | null)?.value ?? '';
  }

  private captureParentRegistrationForm(): ParentRegistrationForm {
    return {
      host: (this.byId('parent-device-host') as HTMLInputElement | null)?.value ?? this.parentRegistrationForm.host,
      serial: (this.byId('parent-device-serial') as HTMLInputElement | null)?.value ?? this.parentRegistrationForm.serial,
      username: (this.byId('parent-device-username') as HTMLInputElement | null)?.value ?? this.parentRegistrationForm.username,
      password: (this.byId('parent-device-password') as HTMLInputElement | null)?.value ?? this.parentRegistrationForm.password,
      passwordConfirmation: (this.byId('parent-device-password-confirmation') as HTMLInputElement | null)?.value ?? this.parentRegistrationForm.passwordConfirmation,
      allowOverwrite: (this.byId('parent-device-overwrite') as HTMLInputElement | null)?.checked ?? this.parentRegistrationForm.allowOverwrite,
    };
  }

  private openCertificate(): void {
    const hostInput = this.byId('companion-device-host') as HTMLInputElement | null;
    try {
      const host = normalizeCompanionDeviceHost(hostInput?.value ?? '');
      window.open(`https://${host}`, '_blank', 'noopener,noreferrer');
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.captureConnectFields();
      this.render();
    }
  }

  private async connectCompanionDevice(): Promise<void> {
    this.captureConnectFields();
    this.error = '';
    try {
      this.adminCredentials.host = normalizeCompanionDeviceHost(this.adminCredentials.host);
      if (!this.adminCredentials.username || !this.adminCredentials.password) throw new Error('Enter the installer username and password.');
      if (!normalizeSerial(this.expectedSerial)) throw new Error('Enter the expected Companion Device serial number.');
      if (!this.snapshot || !this.configDocument) throw new Error('Select an installation source first.');
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
      return;
    }

    this.busy = true;
    this.render();
    let signedIn = false;
    try {
      this.companionDevice = await connectToCompanionDevice(this.adminCredentials);
      signedIn = true;
      this.certificatePromptVisible = false;
      this.compatibility = await validateConnectedCompanionDevice(this.companionDevice, this.snapshot.manifest, this.expectedSerial);
      if (!this.compatibility.serialMatches) throw new Error('Serial number mismatch. No files were changed, and the serial read from the Companion Device was not displayed.');
      if (!this.compatibility.roomOsSupported) throw new Error(`RoomOS ${this.compatibility.roomOsVersion} is below the required ${this.snapshot.manifest.MinimumRoomOSVersion}.`);
      if (!this.compatibility.productSupported) throw new Error(`${this.compatibility.productPlatform} is not supported by the selected release.`);
      this.installed = await listInstalledMacros(this.companionDevice);
      this.configValues = new Map(this.configDocument.leaves.map((leaf) => [configPathId(leaf.path), leaf.value]));
      this.configValues = setLockedInstallerValues(this.configDocument, this.configValues, this.adminCredentials.host);
      for (const leaf of this.configDocument.leaves) {
        if (formatConfigPath(leaf.path) === 'CompanionBoardInformation.username' && !this.configValues.get(configPathId(leaf.path))) {
          this.configValues.set(configPathId(leaf.path), 'custom-companion');
        }
      }
      this.step = 3;
    } catch (error) {
      this.companionDevice?.close();
      this.companionDevice = undefined;
      this.compatibility = undefined;
      if (!signedIn) this.certificatePromptVisible = true;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private reuseAdminCredentials(enabled: boolean): void {
    if (!enabled || !this.configDocument) return;
    for (const leaf of this.configDocument.leaves) {
      const path = formatConfigPath(leaf.path);
      const element = [...this.root.querySelectorAll<HTMLInputElement>('[data-config-id]')]
        .find((candidate) => candidate.dataset.configId === configPathId(leaf.path));
      if (path === 'CompanionBoardInformation.username' && element) element.value = this.adminCredentials.username;
      if (path === 'CompanionBoardInformation.password' && element) element.value = this.adminCredentials.password;
    }
  }

  private readConfigValues(): Map<string, ConfigValue> {
    const result = new Map(this.configValues);
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-config-id]')) {
      if (control.disabled || control.readOnly) continue;
      const id = control.dataset.configId;
      if (!id) continue;
      const type = control.dataset.valueType;
      if (type === 'boolean') result.set(id, (control as HTMLInputElement).checked);
      else if (type === 'number') {
        const value = Number(control.value);
        if (!Number.isFinite(value)) throw new Error('Every numeric configuration value must be a valid number.');
        result.set(id, value);
      } else if (type === 'json') {
        try {
          result.set(id, JSON.parse(control.value) as ConfigValue);
        } catch {
          throw new Error('One of the JSON configuration values is invalid.');
        }
      } else result.set(id, control.value);
    }
    return this.configDocument
      ? setLockedInstallerValues(this.configDocument, result, this.adminCredentials.host)
      : result;
  }

  private callbackCredentials(values: Map<string, ConfigValue>): CompanionDeviceCredentials {
    if (!this.configDocument) throw new Error('The Config macro is unavailable.');
    const get = (path: string) => {
      const leaf = this.configDocument?.leaves.find((item) => formatConfigPath(item.path) === path);
      return leaf ? values.get(configPathId(leaf.path)) : undefined;
    };
    const username = get('CompanionBoardInformation.username');
    const password = get('CompanionBoardInformation.password');
    if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
      throw new Error('Enter the existing Companion Device callback username and password in Companion Device Information.');
    }
    return { host: this.adminCredentials.host, username, password };
  }

  private async validateConfiguration(): Promise<void> {
    try {
      this.activeCallConfirmed = (this.byId('active-call-confirm') as HTMLInputElement | null)?.checked ?? false;
      if (this.compatibility?.activeCalls && !this.activeCallConfirmed) throw new Error('Confirm the active-call warning before continuing.');
      this.configValues = this.readConfigValues();
      const callbackCredentials = this.callbackCredentials(this.configValues);
      this.busy = true;
      this.error = '';
      this.render();
      await validateCallbackCredentials(callbackCredentials);
      if (!this.configDocument || !this.snapshot) throw new Error('The selected source is no longer available.');
      const configuredSource = patchConfigSource(this.configDocument, this.configValues);
      this.preparedResources = this.snapshot.resources.map((resource) =>
        resource.fileName === CONFIG_MACRO_FILE ? { ...resource, content: configuredSource } : { ...resource },
      );
      this.step = 4;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async beginInstall(): Promise<void> {
    if (!this.companionDevice || !this.installationType) return;
    if (this.installationType === 'clean') {
      try {
        const latestInstalled = await listInstalledMacros(this.companionDevice);
        const latestStorage = latestInstalled.find((macro) => macro.name === GENERATED_STORAGE_MACRO);
        this.installed = this.installed.filter((macro) => macro.name !== GENERATED_STORAGE_MACRO);
        if (latestStorage) this.installed.push(latestStorage);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.error = `Unable to confirm ${GENERATED_STORAGE_MACRO} before the clean installation. No files were changed. ${detail}`;
        this.render();
        return;
      }
    }
    const purgeControl = this.byId('purge-legacy') as HTMLInputElement | null;
    this.purgeLegacy = purgeControl?.checked ?? true;
    this.error = '';
    this.installError = '';
    this.installOutcome = undefined;
    this.macroLogs = [];
    this.step = 6;
    this.installProgress = 'Subscribing to the macro event log';
    this.monitor = new InitializationMonitor(
      this.companionDevice,
      (classification, message) => {
        this.macroLogs.push({ classification, message: this.sanitizeLog(message) });
        if (this.macroLogs.length > 100) this.macroLogs.shift();
        this.render();
      },
      new Set(this.preparedResources.map((resource) => resource.macroName)),
    );
    this.render();
    try {
      await installMacroResources(
        this.companionDevice,
        this.preparedResources,
        this.installed,
        {
          purgeLegacy: this.purgeLegacy,
          purgeGeneratedStorage: this.installationType === 'clean',
        },
        (message) => { this.installProgress = message; this.render(); },
      );
      this.installProgress = 'Waiting for Custom Companion initialization';
      this.render();
      await this.waitForInitialization();
    } catch (error) {
      this.installError = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private sanitizeLog(message: string, additionalSecrets: string[] = []): string {
    let result = message;
    const secrets = [this.adminCredentials.password, ...additionalSecrets];
    try {
      secrets.push(this.callbackCredentials(this.configValues).password);
    } catch {
      // Config validation already reports missing callback credentials.
    }
    for (const secret of secrets) {
      if (secret) result = result.split(secret).join('[redacted]');
    }
    return result;
  }

  private async waitForInitialization(): Promise<void> {
    if (!this.monitor) return;
    this.busy = true;
    this.installOutcome = undefined;
    this.render();
    this.installOutcome = await this.monitor.wait();
    this.busy = false;
    this.render();
  }

  private async restartRuntime(): Promise<void> {
    if (!this.companionDevice) return;
    this.installProgress = 'Restarting the macro runtime';
    this.installOutcome = undefined;
    this.render();
    try {
      await this.companionDevice.command('Macros Runtime Restart');
      await this.waitForInitialization();
    } catch (error) {
      this.installError = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private continueToCompleteSetup(): void {
    this.monitor?.close();
    this.monitor = undefined;
    this.macroLogs = [];
    this.error = '';
    this.installError = '';
    this.step = 7;
    this.render();
  }

  private openParentRegistration(): void {
    if ((!this.companionDevice && !this.localReviewMode) || this.busy) return;
    this.resetParentRegistrationForm(false);
    this.parentRegistrationModalOpen = true;
    this.render();
  }

  private closeParentRegistration(): void {
    if (this.busy || this.parentRegistrationOutcome?.kind === 'timeout') return;
    this.parentRegistrationModalOpen = false;
    this.resetParentRegistrationForm(false);
    this.render();
  }

  private async beginParentRegistration(): Promise<void> {
    if (!this.parentRegistrationModalOpen || !this.companionDevice || this.localReviewMode) return;
    this.parentRegistrationForm = this.captureParentRegistrationForm();
    let request: ParentRegistrationRequest;
    try {
      request = createParentRegistrationRequest(this.parentRegistrationForm, this.expectedSerial);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
      return;
    }

    this.parentRegistrationMonitor?.close();
    this.parentRegistrationLogs = [];
    this.parentRegistrationOutcome = undefined;
    this.error = '';
    this.busy = true;
    this.parentRegistrationMonitor = new ParentRegistrationMonitor(
      this.companionDevice,
      request.transactionId,
      (message) => {
        this.parentRegistrationLogs.push(this.sanitizeLog(message, [this.parentRegistrationForm.password]));
        if (this.parentRegistrationLogs.length > 50) this.parentRegistrationLogs.shift();
        this.render();
      },
    );
    this.render();
    try {
      await sendParentRegistrationRequest(this.companionDevice, request);
      await this.waitForParentRegistration();
    } catch (error) {
      this.parentRegistrationMonitor?.close();
      this.parentRegistrationMonitor = undefined;
      this.busy = false;
      this.error = 'Unable to start Parent Room Device registration. ' + this.sanitizeLog(
        error instanceof Error ? error.message : String(error),
        [this.parentRegistrationForm.password],
      );
      this.parentRegistrationForm.password = '';
      this.parentRegistrationForm.passwordConfirmation = '';
      this.render();
    }
  }

  private async waitForParentRegistration(): Promise<void> {
    if (!this.parentRegistrationMonitor) return;
    this.busy = true;
    this.render();
    this.parentRegistrationOutcome = await this.parentRegistrationMonitor.wait();
    this.busy = false;
    if (this.parentRegistrationOutcome.kind !== 'timeout') {
      this.parentRegistrationMonitor.close();
      this.parentRegistrationMonitor = undefined;
      this.parentRegistrationForm.password = '';
      this.parentRegistrationForm.passwordConfirmation = '';
    }
    this.render();
  }

  private parentRegistrationResultText(message: string | undefined): string {
    if (!message) return 'The Companion Device reported that the Parent Room Device could not be registered.';
    const detail = /"Detail"\s*:\s*"((?:\\.|[^"])*)"/.exec(message)?.[1];
    if (!detail) return 'The Companion Device reported that the Parent Room Device could not be registered.';
    try {
      return JSON.parse('"' + detail + '"') as string;
    } catch {
      return detail;
    }
  }

  private resetParentRegistrationForm(render = true): void {
    this.parentRegistrationForm = {
      host: '',
      serial: '',
      username: '',
      password: '',
      passwordConfirmation: '',
      allowOverwrite: false,
    };
    this.parentRegistrationOutcome = undefined;
    this.parentRegistrationLogs = [];
    this.error = '';
    if (render) this.render();
  }

  private reset(): void {
    this.monitor?.close();
    this.monitor = undefined;
    this.parentRegistrationMonitor?.close();
    this.parentRegistrationMonitor = undefined;
    this.companionDevice?.close();
    this.companionDevice = undefined;
    this.step = 0;
    this.error = '';
    this.snapshot = undefined;
    this.compatibility = undefined;
    this.installed = [];
    this.configDocument = undefined;
    this.configValues.clear();
    this.preparedResources = [];
    this.adminCredentials = { host: '', username: '', password: '' };
    this.expectedSerial = '';
    this.activeCallConfirmed = false;
    this.installationType = undefined;
    this.purgeLegacy = true;
    this.installProgress = '';
    this.installOutcome = undefined;
    this.installError = '';
    this.macroLogs = [];
    this.parentRegistrationForm = {
      host: '',
      serial: '',
      username: '',
      password: '',
      passwordConfirmation: '',
      allowOverwrite: false,
    };
    this.parentRegistrationOutcome = undefined;
    this.parentRegistrationLogs = [];
    this.parentRegistrationModalOpen = false;
    this.betaAcknowledged = false;
    this.localReviewMode = false;
    this.certificatePromptVisible = false;
    this.completionHost = '';
    this.render();
  }
}
