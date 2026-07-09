import * as vscode from 'vscode';
import { toCsv } from '../core/csv';
import { summaryCsv } from '../core/summary';
import { MonthReport, UsageEvent } from '../types';

/** Save the aggregated per-repository summary of a month report as CSV. */
export async function exportSummary(report: MonthReport): Promise<void> {
  if (report.repos.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data to export yet.'),
    );
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`ai-summary-${report.month}.csv`),
    filters: { CSV: ['csv'] },
  });
  if (!uri) {
    return;
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(summaryCsv(report), 'utf8'));
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: summary exported to {0}', uri.fsPath),
  );
}

export async function exportUsage(events: UsageEvent[], format: 'csv' | 'json'): Promise<void> {
  if (events.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('Copilot Cost Lens: no usage data to export yet.'),
    );
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`copilot-usage-${stamp}.${format}`),
    filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
  });
  if (!uri) {
    return;
  }

  const content = format === 'csv' ? toCsv(events) : JSON.stringify(events, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Copilot Cost Lens: exported {0} records to {1}', events.length, uri.fsPath),
  );
}

