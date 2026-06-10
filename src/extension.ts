import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { availableMonths, buildMonthReport, currentMonthKey } from './core/aggregate';
import { PLAN_CREDITS } from './core/pricing';
import { exportUsage } from './commands/export';
import { StoreConfig, UsageStore } from './data/usageStore';
import { Dashboard } from './ui/dashboard';
import { CostStatusBar } from './ui/statusBar';
import { CostTreeProvider } from './ui/treeView';
import { MonthReport } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new UsageStore(readStoreConfig());
  const statusBar = new CostStatusBar();
  const tree = new CostTreeProvider();
  const dashboard = new Dashboard({
    getReport: (month) => buildReport(store, month),
    getMonths: () => availableMonths(store.getEvents()),
    refresh: async () => {
      await store.refresh();
    },
    exportData: (format) => exportUsage(store.getEvents(), format),
  });

  context.subscriptions.push(
    statusBar,
    dashboard,
    vscode.window.registerTreeDataProvider('copilotCostLens.byRepo', tree),
    vscode.commands.registerCommand('copilotCostLens.openDashboard', () => dashboard.show()),
    vscode.commands.registerCommand('copilotCostLens.refresh', () => store.refresh()),
    vscode.commands.registerCommand('copilotCostLens.exportCsv', () => exportUsage(store.getEvents(), 'csv')),
    vscode.commands.registerCommand('copilotCostLens.exportJson', () => exportUsage(store.getEvents(), 'json')),
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
    const report = buildReport(store);
    statusBar.update(report, statusBarOptions());
    tree.setReport(report);
    dashboard.notifyDataChanged();
    maybeWarnBudget(context, report);
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

function statusBarOptions(): { enabled: boolean; warnAtPercent: number } {
  const config = vscode.workspace.getConfiguration('copilotCostLens');
  return {
    enabled: config.get<boolean>('statusBar.enabled', true),
    warnAtPercent: config.get<number>('warnAtPercent', 80),
  };
}

function buildReport(store: UsageStore, month?: string): MonthReport {
  return buildMonthReport(store.getEvents(), {
    month: month ?? currentMonthKey(),
    includedCredits: includedCredits(),
  });
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
    ? `$${report.totalUsd.toFixed(2)} of your $${budgetUsd.toFixed(2)} budget`
    : `${report.usedPercent.toFixed(0)}% of your included AI Credits`;
  void vscode.window
    .showWarningMessage(`Copilot Cost Lens: you have used ${what} this month.`, 'Open Dashboard')
    .then((choice) => {
      if (choice === 'Open Dashboard') {
        void vscode.commands.executeCommand('copilotCostLens.openDashboard');
      }
    });
}
