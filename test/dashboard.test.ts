import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { DashboardController, DashboardDelegate, isIncomingMessage } from '../src/ui/dashboard';
import { buildMonthReport, buildRepoDetail } from '../src/core/aggregate';
import { renderDashboardHtml } from '../src/ui/dashboardHtml';
import { webviewStrings } from '../src/ui/strings';

vi.mock('vscode', () => ({
  Disposable: class { constructor(public dispose: () => void) {} },
  l10n: { t: (text: string) => text },
  window: { showErrorMessage: vi.fn() },
}));

describe('webview message boundary', () => {
  it('rejects malformed and oversized payloads before dispatch', () => {
    for (const message of [
      null, [], 'ready', {}, { type: 'unknown' },
      { type: 'selectMonth', month: {} },
      { type: 'selectMonth', month: 'range:2026-06-01..2026-06-02..junk' },
      { type: 'toggleStar', repo: ['repo'] },
      { type: 'saveGroup', name: 'group', members: [42] },
      { type: 'saveGroup', name: ' ', members: ['repo'] },
      { type: 'export', format: '../../etc' },
      { type: 'exportReceipt', all: true, repo: 'repo' },
      { type: 'setAllowance', value: NaN },
      { type: 'setAllowance', value: -1 },
      { type: 'openRepo', path: 'x'.repeat(4097) },
    ]) expect(isIncomingMessage(message), JSON.stringify(message)).toBe(false);
  });

  it('accepts legitimate navigation and mutations', () => {
    for (const message of [
      { type: 'ready' }, { type: 'selectRepo', repo: null },
      { type: 'selectMonth', month: 'range:2026-06-01..2026-06-02' },
      { type: 'export', format: 'json' }, { type: 'setAllowance', value: 0 },
      { type: 'saveGroup', name: '__proto__', members: ['repo'] },
    ]) expect(isIncomingMessage(message)).toBe(true);
  });

  it('limits local resources and folder opening to the selected repository', async () => {
    const events = [{ sessionId: 's', provider: 'copilot' as const, repo: { name: 'repo', folderPath: '/known' },
      timestamp: 1750000000000, model: 'gpt-5-mini', inputTokens: 1, outputTokens: 0,
      cachedTokens: 0, cacheWriteTokens: 0, credits: 1, costSource: 'computed' as const }];
    const openRepo = vi.fn();
    const delegate = {
      getMonths: () => ['all'], getReport: () => buildMonthReport(events, { month: 'all', includedCredits: 0 }),
      getRepoDetail: (repoName: string, month: string) => buildRepoDetail(events, { repoName, month }),
      getAllRepos: () => [], getGroupsConfig: () => ({}), getStarred: () => [],
      getStats: () => ({}), getCurrency: () => ({ code: 'USD', rate: 1 }), getHiddenCount: () => 0,
      openRepo,
    } as unknown as DashboardDelegate;
    let receive!: (message: unknown) => Promise<void>;
    const unsubscribe = vi.fn();
    const webview = {
      options: {}, html: '', postMessage: vi.fn(),
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose: unsubscribe }; },
    };
    const attached = new DashboardController(delegate).attach(webview as unknown as vscode.Webview);
    expect(webview.options).toEqual({ enableScripts: true, localResourceRoots: [] });
    await receive({ type: 'openRepo', path: '/known' });
    await receive({ type: 'selectRepo', repo: 'repo' });
    await receive({ type: 'openRepo', path: '/arbitrary' });
    expect(openRepo).not.toHaveBeenCalled();
    await receive({ type: 'openRepo', path: '/known' });
    expect(openRepo).toHaveBeenCalledWith('/known');
    attached.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

it('renders reports safely and updates diagnostics without a change in totals', async () => {
  const { runInNewContext } = await import('node:vm');
  const elements = new Map<string, { innerHTML: string; textContent: string; value: string; addEventListener(): void }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', addEventListener() {} });
    return elements.get(id)!;
  };
  let receive!: (event: { data: unknown }) => void;
  const html = renderDashboardHtml(webviewStrings());
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]!;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage() {}, getState: () => undefined, setState() {} }),
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener: (_type: string, fn: typeof receive) => { receive = fn; }, scrollTo() {} },
  });
  const events = [{ sessionId: 's', provider: 'copilot' as const, repo: { name: '<img src="https://invalid.test/leak">' },
    timestamp: 1750000000000, model: 'gpt-5-mini', inputTokens: 100, outputTokens: 1,
    cachedTokens: 50, cacheWriteTokens: 0, credits: 1, costSource: 'computed' as const }];
  const report = buildMonthReport(events, { month: 'all', includedCredits: 0 });
  const data = { type: 'data', report, selectedMonth: 'all', months: ['2025-06'], starred: [], groupsConfig: {},
    currency: { code: 'USD', rate: 1 }, stats: { providers: { copilot: 1 }, errors: [] as string[] } };
  receive({ data });
  expect(element('app').innerHTML).toContain('&lt;img');
  expect(element('app').innerHTML).not.toContain('<img src=');
  receive({ data: { ...data, stats: { ...data.stats, errors: ['Unreadable log'] } } });
  expect(element('foot').innerHTML).toContain('Unreadable log');
  receive({ data: { ...data, detail: buildRepoDetail(events, { month: 'all', repoName: events[0]!.repo.name }) } });
  expect(element('app').innerHTML).toContain('33%');
});
