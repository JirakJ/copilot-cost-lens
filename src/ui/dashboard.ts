import * as vscode from 'vscode';
import { renderDashboardHtml } from './dashboardHtml';
import { MonthReport } from '../types';

export interface DashboardDelegate {
  getReport(month?: string): MonthReport;
  getMonths(): string[];
  refresh(): Promise<void>;
  exportData(format: 'csv' | 'json'): Promise<void>;
}

export class Dashboard implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private selectedMonth?: string;

  constructor(private delegate: DashboardDelegate) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'copilotCostLens.dashboard',
      'Copilot Cost Lens',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (message: { type: string; month?: string; format?: 'csv' | 'json' }) => {
      switch (message.type) {
        case 'ready':
          this.postData();
          break;
        case 'selectMonth':
          this.selectedMonth = message.month;
          this.postData();
          break;
        case 'refresh':
          await this.delegate.refresh();
          this.postData();
          break;
        case 'export':
          await this.delegate.exportData(message.format ?? 'csv');
          break;
        case 'openSettings':
          void vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@ext:JakubJirak.copilot-cost-lens',
          );
          break;
      }
    });

    this.panel.webview.html = renderDashboardHtml();
  }

  /** Push fresh data into the panel if it is open. */
  notifyDataChanged(): void {
    this.postData();
  }

  private postData(): void {
    if (!this.panel) {
      return;
    }
    const months = this.delegate.getMonths();
    const month = this.selectedMonth && months.includes(this.selectedMonth) ? this.selectedMonth : months[0];
    void this.panel.webview.postMessage({
      type: 'data',
      report: this.delegate.getReport(month),
      months,
      selectedMonth: month,
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
