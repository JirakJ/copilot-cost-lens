import * as vscode from 'vscode';
import { MonthReport } from '../types';

export class CostStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('copilotCostLens.status', vscode.StatusBarAlignment.Right, 95);
    this.item.name = 'Copilot Cost Lens';
    this.item.command = 'copilotCostLens.openDashboard';
  }

  update(report: MonthReport, options: { enabled: boolean; warnAtPercent: number }): void {
    if (!options.enabled) {
      this.item.hide();
      return;
    }

    const usd = report.totalUsd.toFixed(2);
    const credits = formatCredits(report.totalCredits);
    const spark = sparkline(report);
    this.item.text = `$(graph-line) ${credits} cr · $${usd}${spark ? ' ' + spark : ''}`;

    const overWarn =
      report.includedCredits > 0 && report.usedPercent >= options.warnAtPercent;
    this.item.backgroundColor = overWarn
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;

    const t = vscode.l10n.t;
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Copilot Cost Lens — ${report.month}**\n\n`);
    md.appendMarkdown(t('Spend: **${0}** ({1} credits)', usd, credits) + '\n\n');
    if (report.providers.length > 1) {
      const names: Record<string, string> = {
        copilot: 'Copilot',
        'copilot-cli': 'Copilot CLI',
        'claude-code': 'Claude Code',
      };
      md.appendMarkdown(
        report.providers
          .map((p) => `${names[p.provider] ?? p.provider}: $${p.usd.toFixed(2)}`)
          .join(' · ') + '\n\n',
      );
    }
    if (report.includedCredits > 0) {
      md.appendMarkdown(
        t(
          'Copilot allowance: {0}% of {1} credits',
          report.usedPercent.toFixed(0),
          report.includedCredits.toLocaleString('en-US'),
        ) + '\n\n',
      );
    }
    md.appendMarkdown(t('Forecast: ${0} by end of month', report.forecastUsd.toFixed(2)) + '\n\n');
    if (report.repos.length > 0) {
      md.appendMarkdown(`---\n\n`);
      for (const repo of report.repos.slice(0, 3)) {
        md.appendMarkdown(`$(repo) ${repo.repo.name}: **$${repo.usd.toFixed(2)}**\n\n`);
      }
    }
    if (report.hasEstimates) {
      md.appendMarkdown(`---\n\n$(info) ` + t('Includes estimated entries') + '\n');
    }
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** Last 7 calendar days of spend as unicode blocks, gaps included as zero. */
export function sparkline(report: MonthReport, now = new Date()): string {
  const blocks = '▁▂▃▄▅▆▇█';
  const byDay = new Map(report.days.map((d) => [d.day, d.usd]));
  const values: number[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    values.push(byDay.get(key) ?? 0);
  }
  const max = Math.max(...values);
  if (max <= 0) {
    return '';
  }
  return values
    .map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))])
    .join('');
}

export function formatCredits(credits: number): string {
  if (credits >= 100) {
    return Math.round(credits).toLocaleString('en-US');
  }
  return credits.toFixed(1);
}
