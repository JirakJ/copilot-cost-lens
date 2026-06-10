import * as vscode from 'vscode';
import { UsageEvent } from '../types';

export async function exportUsage(events: UsageEvent[], format: 'csv' | 'json'): Promise<void> {
  if (events.length === 0) {
    void vscode.window.showInformationMessage('Copilot Cost Lens: no usage data to export yet.');
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
    `Copilot Cost Lens: exported ${events.length} records to ${uri.fsPath}`,
  );
}

export function toCsv(events: UsageEvent[]): string {
  const header = [
    'timestamp',
    'repo',
    'model',
    'sessionId',
    'inputTokens',
    'outputTokens',
    'cachedTokens',
    'credits',
    'usd',
    'costSource',
  ];
  const rows = events.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      csvField(e.repo.name),
      csvField(e.model),
      e.sessionId,
      e.inputTokens,
      e.outputTokens,
      e.cachedTokens,
      e.credits.toFixed(4),
      (e.credits * 0.01).toFixed(4),
      e.costSource,
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
