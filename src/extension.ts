import * as fs from 'node:fs';
import * as vscode from 'vscode';
import {
  ALL_TIME,
  availableMonths,
  buildGroupDetail,
  buildMonthReport,
  buildRepoDetail,
  currentMonthKey,
  ProjectGroups,
} from './core/aggregate';
import { PLAN_CREDITS } from './core/pricing';
import {
  buildInvoicePdf,
  buildReceiptPdf,
  invoiceFromGroup,
  invoiceFromRepo,
} from './core/receiptPdf';
import { exportUsage } from './commands/export';
import { StoreConfig, UsageStore } from './data/usageStore';
import { DashboardController, DashboardPanel, DashboardViewProvider } from './ui/dashboard';
import { CostStatusBar } from './ui/statusBar';
import { invoiceStrings, receiptStrings } from './core/receiptStrings';
import { MonthReport } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new UsageStore(readStoreConfig());
  const statusBar = new CostStatusBar();

  const controller = new DashboardController({
    getReport: (month) => buildReport(store, month),
    getMonths: () => availableMonths(store.getEvents()),
    getRepoDetail: (repoName, month) => buildRepoDetail(store.getEvents(), { repoName, month }),
    getGroupDetail: (groupName, month) => {
      const members = projectGroups()[groupName];
      return members
        ? buildGroupDetail(store.getEvents(), { name: groupName, members, month })
        : undefined;
    },
    getStats: () => store.getStats(),
    refresh: async () => {
      await store.refresh();
    },
    exportData: (format) => exportUsage(store.getEvents(), format),
    exportReceipt: (repoName, month) => exportReceipt(store, repoName, month),
    exportInvoice: (target, month) => exportInvoice(store, target, month),
    setAllowance: (value) => setAllowance(value),
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
    vscode.commands.registerCommand('copilotCostLens.exportInvoice', () => pickAndExportInvoice(store)),
    vscode.commands.registerCommand('copilotCostLens.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:JakubJirak.copilot-cost-lens'),
    ),
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
    maybeWarnBudget(context, report);
    checkCreditAlerts(context, report);

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
    extraStorageRoots: config.get<string[]>('extraStorageRoots', []),
    claudeCodeEnabled: config.get<boolean>('claudeCode.enabled', true),
    copilotCliEnabled: config.get<boolean>('copilotCli.enabled', true),
    estimationEnabled: config.get<boolean>('estimation.enabled', true),
    charsPerToken: config.get<number>('estimation.charsPerToken', 4),
    pricing: {
      overrides: config.get('priceOverrides', {}),
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

function statusBarOptions(): { enabled: boolean; warnAtPercent: number } {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return {
    enabled: config.get<boolean>('statusBar.enabled', true),
    warnAtPercent: config.get<number>('warnAtPercent', 80),
  };
}

function projectGroups(): ProjectGroups {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const raw = config.get<Record<string, unknown>>('projectGroups', {});
  const groups: ProjectGroups = {};
  for (const [name, members] of Object.entries(raw)) {
    if (Array.isArray(members)) {
      groups[name] = members.filter((m): m is string => typeof m === 'string');
    }
  }
  return groups;
}

function buildReport(store: UsageStore, month: string): MonthReport {
  return buildMonthReport(store.getEvents(), {
    month,
    includedCredits: includedCredits(),
    groups: projectGroups(),
  });
}

async function exportInvoice(
  store: UsageStore,
  target: { repo?: string; group?: string },
  month: string,
): Promise<void> {
  let data;
  if (target.group) {
    const members = projectGroups()[target.group];
    const detail = members
      ? buildGroupDetail(store.getEvents(), { name: target.group, members, month })
      : undefined;
    data = detail ? invoiceFromGroup(detail) : undefined;
  } else if (target.repo) {
    const detail = buildRepoDetail(store.getEvents(), { repoName: target.repo, month });
    data = detail ? invoiceFromRepo(detail) : undefined;
  }
  const name = target.group ?? target.repo ?? '';
  if (!data) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data for {0} in this period.', name),
    );
    return;
  }

  const pdf = buildInvoicePdf(data, invoiceStrings(vscode.env.language));
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const period = month === ALL_TIME ? 'all-time' : month;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`invoice-${safeName}-${period}.pdf`),
    filters: { PDF: ['pdf'] },
  });
  if (!uri) {
    return;
  }
  await vscode.workspace.fs.writeFile(uri, pdf);
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: invoice saved to {0}', uri.fsPath),
  );
}

/** Command-palette path: pick a project group or repository, then export. */
async function pickAndExportInvoice(store: UsageStore): Promise<void> {
  const groups = projectGroups();
  const report = buildMonthReport(store.getEvents(), {
    month: ALL_TIME,
    includedCredits: 0,
    groups,
  });
  const items: (vscode.QuickPickItem & { target: { repo?: string; group?: string } })[] = [
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
    title: vscode.l10n.t('Export invoice for which project?'),
  });
  if (picked) {
    await exportInvoice(store, picked.target, ALL_TIME);
  }
}

/**
 * Absolute AI-credit thresholds (e.g. 2,500 AIC). Each threshold fires a
 * notification at most once per month, tracked in global state.
 */
function checkCreditAlerts(context: vscode.ExtensionContext, report: MonthReport): void {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  const thresholds = config
    .get<number[]>('creditAlerts', [])
    .filter((value) => Number.isFinite(value) && value > 0);

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

async function exportReceipt(store: UsageStore, repoName: string, month: string): Promise<void> {
  const detail = buildRepoDetail(store.getEvents(), { repoName, month });
  if (!detail) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data for {0} in this period.', repoName),
    );
    return;
  }

  const pdf = buildReceiptPdf(detail, receiptStrings(vscode.env.language));
  const safeName = repoName.replace(/[^a-zA-Z0-9._-]+/g, '-');
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

/** Command-palette path: pick a repository first, then export its receipt. */
async function pickRepoAndExportReceipt(store: UsageStore): Promise<void> {
  const report = buildMonthReport(store.getEvents(), { month: ALL_TIME, includedCredits: 0 });
  if (report.repos.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data to export yet.'),
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    report.repos.map((r) => ({
      label: r.repo.name,
      description: `$${r.usd.toFixed(2)}`,
    })),
    { title: vscode.l10n.t('Export receipt for which project?') },
  );
  if (picked) {
    await exportReceipt(store, picked.label, ALL_TIME);
  }
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
