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
    this.item.text = `$(graph-line) ${credits} cr · $${usd}`;

    const overWarn =
      report.includedCredits > 0 && report.usedPercent >= options.warnAtPercent;
    this.item.backgroundColor = overWarn
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**Copilot Cost Lens — ${report.month}**\n\n`);
    md.appendMarkdown(`Spend: **$${usd}** (${credits} AI Credits)\n\n`);
    if (report.includedCredits > 0) {
      md.appendMarkdown(
        `Allowance: ${report.usedPercent.toFixed(0)}% of ${report.includedCredits.toLocaleString('en-US')} credits\n\n`,
      );
    }
    md.appendMarkdown(`Forecast: $${report.forecastUsd.toFixed(2)} by end of month\n\n`);
    if (report.repos.length > 0) {
      md.appendMarkdown(`---\n\n`);
      for (const repo of report.repos.slice(0, 3)) {
        md.appendMarkdown(`$(repo) ${repo.repo.name}: **$${repo.usd.toFixed(2)}**\n\n`);
      }
    }
    if (report.hasEstimates) {
      md.appendMarkdown(`---\n\n$(info) Includes estimated entries\n`);
    }
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

export function formatCredits(credits: number): string {
  if (credits >= 100) {
    return Math.round(credits).toLocaleString('en-US');
  }
  return credits.toFixed(1);
}
