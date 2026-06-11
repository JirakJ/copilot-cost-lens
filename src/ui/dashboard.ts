import * as vscode from 'vscode';
import { renderDashboardHtml } from './dashboardHtml';
import { webviewStrings } from './strings';
import { GroupDetail, RepoDetail } from '../core/aggregate';
import { ScanStats } from '../data/usageStore';
import { MonthReport } from '../types';

export interface DashboardDelegate {
  getReport(month: string): MonthReport;
  /** Real data months, newest first (current month always included). */
  getMonths(): string[];
  getRepoDetail(repoName: string, month: string): RepoDetail | undefined;
  getGroupDetail(groupName: string, month: string): GroupDetail | undefined;
  getStats(): ScanStats;
  /** Every repository with all-time spend — feeds the project editor list. */
  getAllRepos(): { name: string; usd: number }[];
  refresh(): Promise<void>;
  exportData(format: 'csv' | 'json'): Promise<void>;
  exportReceipt(target: { repo?: string; group?: string }, month: string): Promise<void>;
  exportInvoice(target: { repo?: string; group?: string }, month: string): Promise<void>;
  setAllowance(value: number | 'custom'): Promise<void>;
  saveGroup(originalName: string | undefined, name: string, members: string[]): Promise<void>;
  deleteGroup(name: string): Promise<void>;
}

interface IncomingMessage {
  type: string;
  month?: string;
  repo?: string;
  group?: string;
  format?: 'csv' | 'json';
  value?: number | 'custom';
  originalName?: string;
  name?: string;
  members?: string[];
}

/**
 * One controller drives every dashboard surface — the sidebar webview view
 * and any number of full editor panels — with shared month/repo selection.
 */
export class DashboardController {
  private webviews = new Set<vscode.Webview>();
  private selectedMonth?: string;
  private selectedRepo?: string;
  private selectedGroup?: string;

  constructor(private delegate: DashboardDelegate) {}

  attach(webview: vscode.Webview): vscode.Disposable {
    webview.options = { enableScripts: true };
    webview.html = renderDashboardHtml(webviewStrings());
    this.webviews.add(webview);

    const subscription = webview.onDidReceiveMessage(async (message: IncomingMessage) => {
      switch (message.type) {
        case 'ready':
          this.postData(webview);
          break;
        case 'selectMonth':
          this.selectedMonth = message.month;
          this.selectedRepo = undefined;
          this.selectedGroup = undefined;
          this.postAll();
          break;
        case 'selectRepo':
          this.selectedRepo = message.repo || undefined;
          this.selectedGroup = undefined;
          this.postAll();
          break;
        case 'selectGroup':
          this.selectedGroup = message.group || undefined;
          this.selectedRepo = undefined;
          this.postAll();
          break;
        case 'refresh':
          await this.delegate.refresh();
          this.postAll();
          break;
        case 'export':
          await this.delegate.exportData(message.format ?? 'csv');
          break;
        case 'exportReceipt':
          if (message.repo || message.group) {
            await this.delegate.exportReceipt(
              { repo: message.repo, group: message.group },
              this.currentMonth(),
            );
          }
          break;
        case 'exportInvoice':
          if (message.repo || message.group) {
            await this.delegate.exportInvoice(
              { repo: message.repo, group: message.group },
              this.currentMonth(),
            );
          }
          break;
        case 'saveGroup':
          if (message.name && Array.isArray(message.members) && message.members.length > 0) {
            await this.delegate.saveGroup(message.originalName, message.name, message.members);
            this.selectedGroup = message.name;
            this.selectedRepo = undefined;
            this.postAll();
          }
          break;
        case 'deleteGroup':
          if (message.group) {
            await this.delegate.deleteGroup(message.group);
            this.selectedGroup = undefined;
            this.postAll();
          }
          break;
        case 'setAllowance':
          if (message.value !== undefined) {
            await this.delegate.setAllowance(message.value);
            this.postAll();
          }
          break;
        case 'openSettings':
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:JakubJirak.copilot-cost-lens',
          );
          break;
      }
    });

    return new vscode.Disposable(() => {
      this.webviews.delete(webview);
      subscription.dispose();
    });
  }

  notifyDataChanged(): void {
    this.postAll();
  }

  private currentMonth(): string {
    const months = this.delegate.getMonths();
    if (this.selectedMonth === 'all' || (this.selectedMonth && months.includes(this.selectedMonth))) {
      return this.selectedMonth;
    }
    return months[0] ?? 'all';
  }

  private postAll(): void {
    for (const webview of this.webviews) {
      this.postData(webview);
    }
  }

  private postData(webview: vscode.Webview): void {
    const month = this.currentMonth();
    const detail = this.selectedRepo
      ? this.delegate.getRepoDetail(this.selectedRepo, month)
      : undefined;
    if (this.selectedRepo && !detail) {
      this.selectedRepo = undefined;
    }
    const groupDetail = this.selectedGroup
      ? this.delegate.getGroupDetail(this.selectedGroup, month)
      : undefined;
    if (this.selectedGroup && !groupDetail) {
      this.selectedGroup = undefined;
    }
    void webview.postMessage({
      type: 'data',
      report: this.delegate.getReport(month),
      months: this.delegate.getMonths(),
      selectedMonth: month,
      detail,
      groupDetail,
      allRepos: this.delegate.getAllRepos(),
      stats: this.delegate.getStats(),
    });
  }
}

/** The sidebar surface — clicking the activity-bar icon lands straight here. */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'copilotCostLens.dashboard';

  constructor(private controller: DashboardController) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const attached = this.controller.attach(view.webview);
    view.onDidDispose(() => attached.dispose());
  }
}

/** The full-size editor panel surface. */
export class DashboardPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private attached?: vscode.Disposable;

  constructor(private controller: DashboardController) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'copilotCostLens.dashboardPanel',
      'Copilot Cost Lens',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.attached = this.controller.attach(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.attached?.dispose();
      this.attached = undefined;
      this.panel = undefined;
    });
  }

  dispose(): void {
    this.attached?.dispose();
    this.panel?.dispose();
  }
}
