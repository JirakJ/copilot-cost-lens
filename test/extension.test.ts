import { afterEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { DashboardDelegate } from '../src/ui/dashboard';
import type { UsageEvent } from '../src/types';
import { activate } from '../src/extension';

const state = vi.hoisted(() => ({
  delegate: undefined as DashboardDelegate | undefined,
  configChanged: undefined as ((event: { affectsConfiguration(key: string): boolean }) => void) | undefined,
  focused: undefined as ((state: { focused: boolean }) => void) | undefined,
  watcherError: undefined as (() => void) | undefined,
  settings: {} as Record<string, unknown>,
  events: [] as UsageEvent[],
  refresh: vi.fn(async () => []), exportUsage: vi.fn(), closeWatcher: vi.fn(), log: vi.fn(),
}));
vi.mock('../src/data/usageStore', () => ({
  UsageStore: class {
    refresh = state.refresh;
    getEvents() { return state.events; }
    getWatchDirs() { return Promise.resolve(['/logs']); }
    onDidChange() {}
    updateConfig() {}
    dispose() {}
  },
}));
vi.mock('../src/ui/dashboard', () => ({
  DashboardController: class { constructor(delegate: DashboardDelegate) { state.delegate = delegate; } },
  DashboardPanel: class { show() {} dispose() {} },
  DashboardViewProvider: class { static viewId = 'dashboard'; },
}));
vi.mock('../src/commands/export', () => ({ exportUsage: state.exportUsage, exportSummary: vi.fn() }));
vi.mock('node:fs', () => ({
  watch: () => ({
    close: state.closeWatcher,
    on: (_event: string, callback: () => void) => { state.watcherError = callback; },
  }),
}));
vi.mock('vscode', () => {
  const disposable = () => ({ dispose() {} });
  return {
    Disposable: class { constructor(public dispose: () => void) {} },
    StatusBarAlignment: { Right: 1 },
    window: {
      createStatusBarItem: () => ({ ...disposable(), show() {}, hide() {} }),
      createOutputChannel: () => ({ ...disposable(), appendLine: state.log }),
      registerWebviewViewProvider: disposable,
      onDidChangeWindowState: (fn: typeof state.focused) => { state.focused = fn; return disposable(); },
    },
    commands: { registerCommand: disposable },
    workspace: {
      getConfiguration: () => ({ get: (key: string, fallback?: unknown) => state.settings[key] ?? fallback }),
      onDidChangeConfiguration: (fn: typeof state.configChanged) => { state.configChanged = fn; return disposable(); },
    },
  };
});

let context: { subscriptions: vscode.Disposable[] };
afterEach(() => {
  for (const subscription of context?.subscriptions ?? []) subscription.dispose();
  vi.useRealTimers();
  vi.clearAllMocks();
  state.settings = {};
});
function start() {
  context = { subscriptions: [] };
  activate(context as unknown as vscode.ExtensionContext);
}

it('exports the selected custom range through the actual dashboard delegate', async () => {
  state.events = [1, 2, 3].map((day) => ({
    sessionId: String(day), provider: 'copilot', repo: { name: 'repo' },
    timestamp: new Date(2026, 5, day, 12).getTime(), model: 'gpt-5-mini',
    inputTokens: 1, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0,
    credits: 1, costSource: 'computed',
  }));
  start();
  await state.delegate!.exportData('csv', 'range:2026-06-02..2026-06-03');
  expect(state.exportUsage).toHaveBeenCalledWith(state.events.slice(1), 'csv');
});

it('restarts watchers on configuration changes and disposes pending timers', async () => {
  vi.useFakeTimers();
  state.settings.refreshIntervalSeconds = 10;
  start();
  await Promise.resolve();
  state.watcherError!();
  expect(state.closeWatcher).toHaveBeenCalledTimes(1);
  state.settings.refreshIntervalSeconds = NaN;
  state.configChanged!({ affectsConfiguration: () => true });
  await Promise.resolve();
  const calls = state.refresh.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(state.refresh).toHaveBeenCalledTimes(calls); // invalid setting falls back to 120s
  state.focused!({ focused: true });
  for (const subscription of context.subscriptions) subscription.dispose();
  context.subscriptions = [];
  await vi.advanceTimersByTimeAsync(120000);
  expect(state.refresh).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(0);
});
