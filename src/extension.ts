import * as fs from 'node:fs';
import * as vscode from 'vscode';
import {
  ALL_TIME,
  availableMonths,
  buildGroupDetail,
  buildMonthReport,
  buildRepoDetail,
  currentMonthKey,
  monthKey,
  ProjectGroups,
  sessionCosts,
} from './core/aggregate';
import { PLAN_CREDITS } from './core/pricing';
import {
  clampCharsPerToken,
  sanitizeNumberArray,
  sanitizeCurrency,
  sanitizePriceOverrides,
  sanitizeProjectGroups,
  sanitizeRepoAliases,
  sanitizeStringArray,
} from './core/config';
import { DisplayCurrency } from './core/money';
import { buildReceiptPdf, receiptFromGroup, receiptFromRepo } from './core/receiptPdf';
import { exportUsage } from './commands/export';
import { StoreConfig, UsageStore } from './data/usageStore';
import { DashboardController, DashboardPanel, DashboardViewProvider } from './ui/dashboard';
import { CostStatusBar } from './ui/statusBar';
import { receiptStrings } from './core/receiptStrings';
import { MonthReport, UsageEvent } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new UsageStore(readStoreConfig());
  const statusBar = new CostStatusBar();

  const controller = new DashboardController({
    getReport: (month) => buildReport(store, month),
    getMonths: () => availableMonths(visibleEvents(store)),
    getRepoDetail: (repoName, month) => buildRepoDetail(visibleEvents(store), { repoName, month }),
    getGroupDetail: (groupName, month) => {
      const members = projectGroups()[groupName];
      return members
        ? buildGroupDetail(visibleEvents(store), { name: groupName, members, month })
        : undefined;
    },
    getStats: () => store.getStats(),
    getAllRepos: () => {
      const report = buildMonthReport(visibleEvents(store), { month: ALL_TIME, includedCredits: 0 });
      return report.repos.map((r) => ({ name: r.repo.name, usd: r.usd }));
    },
    getGroupsConfig: () => projectGroups(),
    getStarred: () => starredRepos(),
    toggleStar: (repoName) => toggleStar(repoName),
    renameRepo: (repoName) => renameRepo(repoName),
    toggleHidden: (repoName) => toggleHidden(repoName),
    getHiddenCount: () => hiddenRepos().length,
    getCurrency: () => displayCurrency(),
    manageHidden: () => manageHiddenRepos(),
    addStorageRoot: () => addStorageRoot(),
    refresh: async () => {
      await store.refresh();
    },
    exportData: (format, month) => exportUsage(eventsInPeriod(store, month), format),
    exportReceipt: (target, month) => exportReceipt(store, target, month),
    setAllowance: (value) => setAllowance(value),
    openRepo: (folderPath) => openRepoFolder(folderPath),
    saveGroup: (originalName, name, members) => saveGroupAs(originalName, name, members),
    deleteGroup: (name) => deleteGroup(name),
  });
  const panel = new DashboardPanel(controller);

  const output = vscode.window.createOutputChannel('Copilot Cost Lens');

  context.subscriptions.push(
    statusBar,
    panel,
    output,
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, new DashboardViewProvider(controller)),
    vscode.commands.registerCommand('copilotCostLens.openDashboard', () => panel.show()),
    vscode.commands.registerCommand('copilotCostLens.refresh', () => store.refresh()),
    vscode.commands.registerCommand('copilotCostLens.exportCsv', () => exportUsage(store.getEvents(), 'csv')),
    vscode.commands.registerCommand('copilotCostLens.exportJson', () => exportUsage(store.getEvents(), 'json')),
    vscode.commands.registerCommand('copilotCostLens.exportReceipt', () => pickRepoAndExportReceipt(store)),
    vscode.commands.registerCommand('copilotCostLens.createProject', () => createGroup(store)),
    vscode.commands.registerCommand('copilotCostLens.manageHidden', () => manageHiddenRepos()),
    vscode.commands.registerCommand('copilotCostLens.addStorageRoot', () => addStorageRoot()),
    vscode.commands.registerCommand('copilotCostLens.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:JakubJirak.copilot-cost-lens'),
    ),
    vscode.commands.registerCommand('copilotCostLens.showDiagnostics', async () => {
      await store.refresh();
      const s = store.getStats();
      output.appendLine('');
      output.appendLine('=== Diagnostics ' + new Date().toISOString() + ' ===');
      output.appendLine(`Scanned roots (${s.scannedRoots.length}):`);
      for (const root of s.scannedRoots) {
        output.appendLine(`  ${root}`);
      }
      output.appendLine(`Files parsed: ${s.filesParsed}`);
      output.appendLine(
        'Events by source: ' +
          (Object.entries(s.providers).map(([p, n]) => `${p}=${n}`).join(', ') || 'none'),
      );
      output.appendLine(
        s.newestTimestamp > 0
          ? `Newest event: ${new Date(s.newestTimestamp).toISOString()}`
          : 'No events found.',
      );
      output.appendLine(`Scan took ${s.scanMs} ms.`);
      if (s.errors.length > 0) {
        output.appendLine('Errors:');
        for (const error of s.errors) {
          output.appendLine(`  ${error}`);
        }
      }
      if (Object.keys(s.providers).length === 0) {
        output.appendLine(
          'No usage found. If you use Copilot/Claude Code elsewhere, add the storage root via copilotCostLens.extraStorageRoots.',
        );
      }
      output.show(true);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('copilotCostLens')) {
        store.updateConfig(readStoreConfig());
        void store.refresh();
      }
    }),
  );

  store.onDidChange(() => {
    const report = buildReport(store, currentMonthKey());
    statusBar.update(report, statusBarOptions());
    controller.notifyDataChanged();
    // budget/credit/session alerts always see the full spend, hidden repos included
    const fullReport = buildMonthReport(store.getEvents(), {
      month: currentMonthKey(),
      includedCredits: includedCredits(),
      groups: projectGroups(),
    });
    maybeWarnBudget(context, fullReport);
    checkCreditAlerts(context, fullReport);
    checkSessionAlerts(context, store);

    const stats = store.getStats();
    output.appendLine(
      `[${new Date().toISOString()}] scan ${stats.scanMs}ms, ${stats.filesParsed} files — ` +
        Object.entries(stats.providers)
          .map(([p, n]) => `${p}: ${n}`)
          .join(', ') +
        (stats.newestTimestamp > 0
          ? ` — newest: ${new Date(stats.newestTimestamp).toISOString()}`
          : ' — no events'),
    );
    for (const error of stats.errors) {
      output.appendLine(`  ERROR ${error}`);
    }
  });

  startBackgroundScanning(context, store);
  void store.refresh();
}

export function deactivate(): void {
  // all resources are released via context.subscriptions
}

function readStoreConfig(): StoreConfig {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return {
    // tolerate malformed user config — never let a bad value break the scan
    extraStorageRoots: sanitizeStringArray(config.get('extraStorageRoots', [])),
    repoAliases: sanitizeRepoAliases(config.get('repoAliases', {})),
    claudeCodeEnabled: config.get<boolean>('claudeCode.enabled', true),
    copilotCliEnabled: config.get<boolean>('copilotCli.enabled', true),
    jetbrainsCopilotEnabled: config.get<boolean>('jetbrainsCopilot.enabled', false),
    estimationEnabled: config.get<boolean>('estimation.enabled', true),
    charsPerToken: clampCharsPerToken(config.get('estimation.charsPerToken', 4)),
    pricing: {
      overrides: sanitizePriceOverrides(config.get('priceOverrides', {})),
    },
  };
}

function includedCredits(): number {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const plan = config.get<string>('plan', 'business');
  if (plan === 'custom') {
    return config.get<number>('includedCreditsPerMonth', 1900);
  }
  return PLAN_CREDITS[plan] ?? 1900;
}

/** Persist an allowance chosen from the dashboard UI. */
async function setAllowance(value: number | 'custom'): Promise<void> {
  let credits = typeof value === 'number' ? value : undefined;
  if (value === 'custom') {
    const input = await vscode.window.showInputBox({
      title: vscode.l10n.t('Monthly Copilot allowance'),
      prompt: vscode.l10n.t('Included AI Credits per month (1 credit = $0.01)'),
      value: String(includedCredits()),
      validateInput: (text) =>
        /^\d+$/.test(text.trim()) ? undefined : vscode.l10n.t('Enter a whole number of credits'),
    });
    if (input === undefined) {
      return;
    }
    credits = Number(input.trim());
  }
  if (credits === undefined || !Number.isFinite(credits) || credits < 0) {
    return;
  }
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  await config.update('plan', 'custom', vscode.ConfigurationTarget.Global);
  await config.update('includedCreditsPerMonth', credits, vscode.ConfigurationTarget.Global);
}

function statusBarOptions(): {
  enabled: boolean;
  warnAtPercent: number;
  currency: DisplayCurrency;
  mode: 'spend' | 'remaining';
} {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const mode = config.get<string>('statusBar.mode', 'spend');
  return {
    enabled: config.get<boolean>('statusBar.enabled', true),
    warnAtPercent: config.get<number>('warnAtPercent', 80),
    currency: displayCurrency(),
    mode: mode === 'remaining' ? 'remaining' : 'spend',
  };
}

function displayCurrency(): DisplayCurrency {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return sanitizeCurrency(config.get('displayCurrency', 'USD'), config.get('usdExchangeRate', 1));
}

function projectGroups(): ProjectGroups {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return sanitizeProjectGroups(config.get('projectGroups', {}));
}

function buildReport(store: UsageStore, month: string): MonthReport {
  return buildMonthReport(visibleEvents(store), {
    month,
    includedCredits: includedCredits(),
    groups: projectGroups(),
  });
}

/**
 * Events minus hidden repositories — what the dashboard and status bar show.
 * Raw exports and budget alerts intentionally keep using the full event set.
 */
function visibleEvents(store: UsageStore): UsageEvent[] {
  const hidden = new Set(hiddenRepos().map((h) => h.toLowerCase()));
  if (hidden.size === 0) {
    return store.getEvents();
  }
  return store.getEvents().filter((e) => !hidden.has(e.repo.name.toLowerCase()));
}

function hiddenRepos(): string[] {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return sanitizeStringArray(config.get('hiddenRepos', []));
}

/** Folder picker appending to extraStorageRoots — the no-data escape hatch. */
async function addStorageRoot(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Add root'),
    title: vscode.l10n.t('Select a folder with Copilot/Claude usage logs'),
  });
  const folder = picked?.[0]?.fsPath;
  if (!folder) {
    return;
  }
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const current = sanitizeStringArray(config.get('extraStorageRoots', []));
  if (current.includes(folder)) {
    return;
  }
  await config.update('extraStorageRoots', [...current, folder], vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: storage root added: {0}', folder),
  );
}

/** QuickPick to unhide repositories: unchecked entries are removed from hiddenRepos. */
async function manageHiddenRepos(): Promise<void> {
  const hidden = hiddenRepos();
  if (hidden.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no hidden repositories.'),
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    hidden.map((name) => ({ label: name, picked: true })),
    {
      title: vscode.l10n.t('Hidden repositories — uncheck to unhide'),
      canPickMany: true,
    },
  );
  if (picked === undefined) {
    return;
  }
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  await config.update(
    'hiddenRepos',
    picked.map((p) => p.label),
    vscode.ConfigurationTarget.Global,
  );
}

async function toggleHidden(repoName: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const current = hiddenRepos();
  const exists = current.some((s) => s.toLowerCase() === repoName.toLowerCase());
  const next = exists
    ? current.filter((s) => s.toLowerCase() !== repoName.toLowerCase())
    : [...current, repoName];
  await config.update('hiddenRepos', next, vscode.ConfigurationTarget.Global);
  if (!exists) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t(
        'Copilot Cost Lens: {0} hidden. Unhide it via the copilotCostLens.hiddenRepos setting.',
        repoName,
      ),
    );
  }
}

/**
 * Absolute AI-credit thresholds (e.g. 2,500 AIC). Each threshold fires a
 * notification at most once per month, tracked in global state.
 */
function checkCreditAlerts(context: vscode.ExtensionContext, report: MonthReport): void {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const thresholds = sanitizeNumberArray(config.get('creditAlerts', []));

  for (const threshold of thresholds) {
    if (report.copilotCredits < threshold) {
      continue;
    }
    const key = `credit-alert-${report.month}-${threshold}`;
    if (context.globalState.get<boolean>(key)) {
      continue;
    }
    void context.globalState.update(key, true);

    const openLabel = vscode.l10n.t('Open Dashboard');
    void vscode.window
      .showWarningMessage(
        vscode.l10n.t(
          'Copilot Cost Lens: Copilot usage crossed {0} AI Credits this month ({1} used, ${2}).',
          threshold.toLocaleString('en-US'),
          Math.round(report.copilotCredits).toLocaleString('en-US'),
          report.copilotUsd.toFixed(2),
        ),
        openLabel,
      )
      .then((choice) => {
        if (choice === openLabel) {
          void vscode.commands.executeCommand('copilotCostLens.openDashboard');
        }
      });
  }
}

/**
 * Warn once per session when a single session's total cost crosses the
 * configured USD threshold — catches runaway agent sessions early. Notified
 * session ids are remembered in global state (capped, oldest dropped).
 */
const SESSION_ALERT_STATE_KEY = 'notifiedSessionAlerts';

function checkSessionAlerts(context: vscode.ExtensionContext, store: UsageStore): void {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const thresholdUsd = config.get<number>('sessionCostAlertUsd', 0);
  if (!Number.isFinite(thresholdUsd) || thresholdUsd <= 0) {
    return;
  }
  const notified = new Set(context.globalState.get<string[]>(SESSION_ALERT_STATE_KEY, []));
  const offenders = sessionCosts(store.getEvents()).filter(
    (s) => s.usd >= thresholdUsd && !notified.has(s.sessionId),
  );
  if (offenders.length === 0) {
    return;
  }
  for (const s of offenders) {
    notified.add(s.sessionId);
  }
  void context.globalState.update(SESSION_ALERT_STATE_KEY, [...notified].slice(-1000));

  const top = offenders.sort((a, b) => b.usd - a.usd)[0]!;
  const openLabel = vscode.l10n.t('Open Dashboard');
  const message =
    offenders.length === 1
      ? vscode.l10n.t(
          'Copilot Cost Lens: a session in {0} has reached ${1}.',
          top.repoName,
          top.usd.toFixed(2),
        )
      : vscode.l10n.t(
          'Copilot Cost Lens: {0} sessions crossed ${1} — the largest in {2} at ${3}.',
          offenders.length,
          thresholdUsd.toFixed(2),
          top.repoName,
          top.usd.toFixed(2),
        );
  void vscode.window.showWarningMessage(message, openLabel).then((choice) => {
    if (choice === openLabel) {
      void vscode.commands.executeCommand('copilotCostLens.openDashboard');
    }
  });
}

function eventsInPeriod(store: UsageStore, month: string) {
  const events = store.getEvents();
  if (month === ALL_TIME) {
    return events;
  }
  return events.filter((e) => monthKey(e.timestamp) === month);
}

async function openRepoFolder(folderPath: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), {
    forceNewWindow: true,
  });
}

async function exportReceipt(
  store: UsageStore,
  target: { repo?: string; group?: string; all?: boolean },
  month: string,
): Promise<void> {
  let data;
  let name = target.group ?? target.repo ?? '';
  if (target.all) {
    // summary receipt: every visible repository in the period as one "group"
    const report = buildMonthReport(visibleEvents(store), { month, includedCredits: 0 });
    const members = report.repos.map((r) => r.repo.name);
    name = vscode.l10n.t('All repositories');
    const detail =
      members.length > 0
        ? buildGroupDetail(visibleEvents(store), { name, members, month })
        : undefined;
    data = detail ? receiptFromGroup(detail) : undefined;
  } else if (target.group) {
    const members = projectGroups()[target.group];
    const detail = members
      ? buildGroupDetail(visibleEvents(store), { name: target.group, members, month })
      : undefined;
    data = detail ? receiptFromGroup(detail) : undefined;
  } else if (target.repo) {
    const detail = buildRepoDetail(visibleEvents(store), { repoName: target.repo, month });
    data = detail ? receiptFromRepo(detail) : undefined;
  }
  if (!data) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data for {0} in this period.', name),
    );
    return;
  }

  const pdf = buildReceiptPdf(data, receiptStrings(documentLocale()));
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const period = month === ALL_TIME ? 'all-time' : month;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`receipt-${safeName}-${period}.pdf`),
    filters: { PDF: ['pdf'] },
  });
  if (!uri) {
    return;
  }
  await vscode.workspace.fs.writeFile(uri, pdf);
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: receipt saved to {0}', uri.fsPath),
  );
}

/** Command-palette path: pick a project group or repository, then export. */
async function pickRepoAndExportReceipt(store: UsageStore): Promise<void> {
  const report = buildMonthReport(visibleEvents(store), {
    month: ALL_TIME,
    includedCredits: 0,
    groups: projectGroups(),
  });
  const items: (vscode.QuickPickItem & { target: { repo?: string; group?: string; all?: boolean } })[] = [
    {
      label: vscode.l10n.t('📅 Entire period (all repositories)'),
      description: `$${report.totalUsd.toFixed(2)}`,
      target: { all: true },
    },
    ...report.groups.map((g) => ({
      label: `📁 ${g.name}`,
      description: `$${g.usd.toFixed(2)} · ${g.repos.length}×`,
      target: { group: g.name },
    })),
    ...report.repos.map((r) => ({
      label: r.repo.name,
      description: `$${r.usd.toFixed(2)}`,
      target: { repo: r.repo.name },
    })),
  ];
  if (items.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data to export yet.'),
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Export receipt for which project?'),
  });
  if (picked) {
    await exportReceipt(store, picked.target, ALL_TIME);
  }
}

// ---------------------------------------------------------------------------
// project group management (dashboard + command palette)
// ---------------------------------------------------------------------------

async function pickMembers(
  store: UsageStore,
  groupName: string,
  preselected: string[],
): Promise<string[] | undefined> {
  const report = buildMonthReport(visibleEvents(store), { month: ALL_TIME, includedCredits: 0 });
  const current = new Set(preselected.map((m) => m.toLowerCase()));
  const items = report.repos.map((r) => ({
    label: r.repo.name,
    description: `$${r.usd.toFixed(2)} · ${r.requestCount}×`,
    picked:
      current.has(r.repo.name.toLowerCase()) ||
      (r.repo.remoteSlug ? current.has(r.repo.remoteSlug.toLowerCase()) : false),
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Select repositories for {0}', groupName),
    canPickMany: true,
  });
  return picked?.map((p) => p.label);
}

async function saveGroup(name: string, members: string[]): Promise<void> {
  await saveGroupAs(undefined, name, members);
}

/**
 * Persist a project group, handling renames (drop the old key). Membership
 * is exclusive: repositories assigned here are removed from other groups.
 */
async function saveGroupAs(
  originalName: string | undefined,
  name: string,
  members: string[],
): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const groups = { ...projectGroups() };
  if (originalName && originalName !== name) {
    delete groups[originalName];
  }
  const claimed = new Set(members.map((m) => m.toLowerCase()));
  for (const [otherName, otherMembers] of Object.entries(groups)) {
    if (otherName !== name) {
      groups[otherName] = otherMembers.filter((m) => !claimed.has(m.toLowerCase()));
    }
  }
  groups[name] = members;
  await config.update('projectGroups', groups, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: project {0} saved ({1} repositories).', name, members.length),
  );
}

/**
 * Language for exported PDF documents (receipts, invoices). Defaults to
 * English — business documents usually travel further than the editor UI.
 */
function documentLocale(): string {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const value = config.get<string>('documentLanguage', 'en');
  return value === 'auto' ? vscode.env.language : value;
}

function starredRepos(): string[] {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return sanitizeStringArray(config.get('starredRepos', []));
}

async function toggleStar(repoName: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const current = starredRepos();
  const exists = current.some((s) => s.toLowerCase() === repoName.toLowerCase());
  const next = exists
    ? current.filter((s) => s.toLowerCase() !== repoName.toLowerCase())
    : [...current, repoName];
  await config.update('starredRepos', next, vscode.ConfigurationTarget.Global);
}

function repoAliases(): Record<string, string> {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return sanitizeRepoAliases(config.get('repoAliases', {}));
}

/**
 * Rename a repository from the dashboard. `currentName` is what the user sees —
 * either the original resolved name or an existing alias; the alias map is
 * always keyed by the original name so renames stay stable across rescans.
 * Clearing the input (or typing the original name) removes the alias.
 */
async function renameRepo(currentName: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const aliases = repoAliases();
  const baseKey =
    Object.entries(aliases).find(([, alias]) => alias.toLowerCase() === currentName.toLowerCase())?.[0] ??
    currentName;

  const input = await vscode.window.showInputBox({
    title: vscode.l10n.t('Rename repository'),
    prompt: vscode.l10n.t('Display name for {0} (leave empty to reset)', baseKey),
    value: currentName,
  });
  if (input === undefined) {
    return;
  }

  const next = { ...aliases };
  const trimmed = input.trim();
  if (!trimmed || trimmed === baseKey) {
    delete next[baseKey];
  } else {
    next[baseKey] = trimmed;
  }
  await config.update('repoAliases', next, vscode.ConfigurationTarget.Global);
}

async function createGroup(store: UsageStore): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t('New project'),
    prompt: vscode.l10n.t('Project name (e.g. MyProduct)'),
    validateInput: (text) => (text.trim() ? undefined : vscode.l10n.t('Enter a project name')),
  });
  if (!name) {
    return;
  }
  const members = await pickMembers(store, name.trim(), []);
  if (!members || members.length === 0) {
    return;
  }
  await saveGroup(name.trim(), members);
}

async function deleteGroup(name: string): Promise<void> {
  const remove = vscode.l10n.t('Delete');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete project {0}? Repositories and their data stay untouched.', name),
    { modal: true },
    remove,
  );
  if (choice !== remove) {
    return;
  }
  const groups = { ...projectGroups() };
  delete groups[name];
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  await config.update('projectGroups', groups, vscode.ConfigurationTarget.Global);
}

/**
 * Watch detected storage roots for log changes (best effort — recursive
 * fs.watch is unavailable on some platforms) and rescan periodically.
 */
function startBackgroundScanning(context: vscode.ExtensionContext, store: UsageStore): void {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const intervalSec = Math.max(10, config.get<number>('refreshIntervalSeconds', 120));

  const timer = setInterval(() => void store.refresh(), intervalSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  let debounce: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => void store.refresh(), 2500);
  };

  void store.getWatchDirs().then((dirs) => {
    for (const dir of dirs) {
      try {
        const watcher = fs.watch(dir, { recursive: true }, scheduleRefresh);
        context.subscriptions.push({ dispose: () => watcher.close() });
      } catch {
        // recursive watch unsupported — the interval rescan still covers us
      }
    }
  });

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        scheduleRefresh();
      }
    }),
  );
}

/** Warn at most once per day when usage crosses the configured threshold. */
function maybeWarnBudget(context: vscode.ExtensionContext, report: MonthReport): void {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const warnAt = config.get<number>('warnAtPercent', 80);
  const budgetUsd = config.get<number>('monthlyBudgetUsd', 0);

  const overAllowance = report.includedCredits > 0 && report.usedPercent >= warnAt;
  const overBudget = budgetUsd > 0 && report.totalUsd >= (budgetUsd * warnAt) / 100;
  if (!overAllowance && !overBudget) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const key = `warned-${report.month}`;
  if (context.globalState.get<string>(key) === today) {
    return;
  }
  void context.globalState.update(key, today);

  const what = overBudget
    ? vscode.l10n.t('${0} of your ${1} budget', report.totalUsd.toFixed(2), budgetUsd.toFixed(2))
    : vscode.l10n.t('{0}% of your included AI Credits', report.usedPercent.toFixed(0));
  const openLabel = vscode.l10n.t('Open Dashboard');
  void vscode.window
    .showWarningMessage(
      vscode.l10n.t('Copilot Cost Lens: you have used {0} this month.', what),
      openLabel,
    )
    .then((choice) => {
      if (choice === openLabel) {
        void vscode.commands.executeCommand('copilotCostLens.openDashboard');
      }
    });
}
