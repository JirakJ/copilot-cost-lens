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
  /** Full project-groups configuration (incl. groups without usage). */
  getGroupsConfig(): Record<string, string[]>;
  getStarred(): string[];
  toggleStar(repoName: string): Promise<void>;
  /** Prompt for and persist a display-name alias for a repository. */
  renameRepo(repoName: string): Promise<void>;
  /** Hide (or unhide) a repository from all dashboard views. */
  toggleHidden(repoName: string): Promise<void>;
  /** Number of currently hidden repositories (for the manage link). */
  getHiddenCount(): number;
  /** Display currency for money formatting in the webview. */
  getCurrency(): { code: string; rate: number };
  /** Open the unhide QuickPick. */
  manageHidden(): Promise<void>;
  refresh(): Promise<void>;
  /** Export usage records for the given period ('all' or YYYY-MM). */
  exportData(format: 'csv' | 'json', month: string): Promise<void>;
  exportReceipt(target: { repo?: string; group?: string; all?: boolean }, month: string): Promise<void>;
  /** Folder picker that appends to copilotCostLens.extraStorageRoots. */
  addStorageRoot(): Promise<void>;
  /** Open a repository folder in a new VS Code window. */
  openRepo(folderPath: string): Promise<void>;
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
  path?: string;
  all?: boolean;
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
          await this.delegate.exportData(message.format ?? 'csv', this.currentMonth());
          break;
        case 'exportReceipt':
          if (message.repo || message.group || message.all) {
            await this.delegate.exportReceipt(
              { repo: message.repo, group: message.group, all: message.all },
              this.currentMonth(),
            );
          }
          break;
        case 'addStorageRoot':
          await this.delegate.addStorageRoot();
          break;
        case 'openRepo':
          if (message.path) {
            await this.delegate.openRepo(message.path);
          }
          break;
        case 'toggleStar':
          if (message.repo) {
            await this.delegate.toggleStar(message.repo);
            this.postAll();
          }
          break;
        case 'renameRepo':
          if (message.repo) {
            // the config write triggers a rescan + postAll on its own
            await this.delegate.renameRepo(message.repo);
          }
          break;
        case 'toggleHidden':
          if (message.repo) {
            this.selectedRepo = undefined; // the detail view just vanished
            await this.delegate.toggleHidden(message.repo);
            this.postAll();
          }
          break;
        case 'manageHidden':
          await this.delegate.manageHidden();
          this.postAll();
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
      groupsConfig: this.delegate.getGroupsConfig(),
      starred: this.delegate.getStarred(),
      stats: this.delegate.getStats(),
      hiddenCount: this.delegate.getHiddenCount(),
      currency: this.delegate.getCurrency(),
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
