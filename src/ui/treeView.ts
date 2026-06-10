import * as vscode from 'vscode';
import { formatCredits } from './statusBar';
import { MonthReport, RepoSummary } from '../types';

type Node = RepoNode | ModelNode | InfoNode;

interface RepoNode {
  kind: 'repo';
  summary: RepoSummary;
}

interface ModelNode {
  kind: 'model';
  label: string;
  description: string;
}

interface InfoNode {
  kind: 'info';
  label: string;
  description?: string;
  icon: string;
}

export class CostTreeProvider implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private report?: MonthReport;

  setReport(report: MonthReport): void {
    this.report = report;
    this.emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'repo': {
        const item = new vscode.TreeItem(
          node.summary.repo.name,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.iconPath = new vscode.ThemeIcon('repo');
        item.description = `$${node.summary.usd.toFixed(2)} · ${formatCredits(node.summary.credits)} cr${node.summary.hasEstimates ? ' ~' : ''}`;
        item.tooltip = repoTooltip(node.summary);
        return item;
      }
      case 'model': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('sparkle');
        item.description = node.description;
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = node.description;
        return item;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (!this.report) {
      return [];
    }
    if (!node) {
      return this.report.repos.map((summary) => ({ kind: 'repo', summary }));
    }
    if (node.kind === 'repo') {
      const children: Node[] = node.summary.models.map((m) => ({
        kind: 'model',
        label: m.model,
        description: `$${m.usd.toFixed(2)} · ${m.requestCount}×`,
      }));
      children.push({
        kind: 'info',
        icon: 'comment-discussion',
        label: `${node.summary.sessionCount} sessions, ${node.summary.requestCount} requests`,
      });
      children.push({
        kind: 'info',
        icon: 'symbol-number',
        label: `${compactTokens(node.summary.inputTokens)} in / ${compactTokens(node.summary.outputTokens)} out`,
        description: `cache ${compactTokens(node.summary.cachedTokens)} r / ${compactTokens(node.summary.cacheWriteTokens)} w`,
      });
      if (node.summary.providers.length > 0) {
        children.push({
          kind: 'info',
          icon: 'plug',
          label: node.summary.providers.map(providerLabel).join(', '),
        });
      }
      return children;
    }
    return [];
  }
}

function repoTooltip(summary: RepoSummary): string {
  const lines = [
    summary.repo.name,
    summary.repo.folderPath ?? '',
    `Spend: $${summary.usd.toFixed(2)} (${formatCredits(summary.credits)} AI Credits)`,
    `Last activity: ${new Date(summary.lastActivity).toLocaleString()}`,
  ];
  if (summary.hasEstimates) {
    lines.push('Contains estimated entries (~)');
  }
  return lines.filter(Boolean).join('\n');
}

export function providerLabel(provider: string): string {
  switch (provider) {
    case 'copilot':
      return 'Copilot';
    case 'copilot-cli':
      return 'Copilot CLI';
    case 'claude-code':
      return 'Claude Code';
    default:
      return provider;
  }
}

export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}
