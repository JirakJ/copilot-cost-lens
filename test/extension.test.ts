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
  foldersChanged: undefined as (() => void) | undefined,
  folders: [] as { uri: { scheme: string; authority: string } }[],
  commands: new Map<string, () => Promise<void>>(),
  settings: {} as Record<string, unknown>,
  events: [] as UsageEvent[],
  refresh: vi.fn(async () => []), exportUsage: vi.fn(), closeWatcher: vi.fn(), log: vi.fn(),
  input: vi.fn(), stat: vi.fn(), readDirectory: vi.fn(), update: vi.fn(),
  information: vi.fn(), warning: vi.fn(),
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
    ConfigurationTarget: { Global: 1 },
    FileType: { Directory: 2 },
    Uri: {
      parse: (value: string) => {
        const url = new URL(value);
        return {
          scheme: url.protocol.slice(0, -1), authority: url.host,
          path: decodeURIComponent(url.pathname), query: url.search.slice(1), fragment: url.hash.slice(1),
          toString: () => value,
        };
      },
    },
    l10n: { t: (value: string) => value },
    window: {
      createStatusBarItem: () => ({ ...disposable(), show() {}, hide() {} }),
      createOutputChannel: () => ({ ...disposable(), appendLine: state.log }),
      registerWebviewViewProvider: disposable,
      onDidChangeWindowState: (fn: typeof state.focused) => { state.focused = fn; return disposable(); },
      showInputBox: state.input,
      showInformationMessage: state.information,
      showWarningMessage: state.warning,
    },
    commands: { registerCommand: (id: string, callback: () => Promise<void>) => {
      state.commands.set(id, callback);
      return disposable();
    } },
    workspace: {
      get workspaceFolders() { return state.folders; },
      fs: { stat: state.stat, readDirectory: state.readDirectory },
      getConfiguration: () => ({
        get: (key: string, fallback?: unknown) => state.settings[key] ?? fallback,
        update: state.update,
      }),
      onDidChangeConfiguration: (fn: typeof state.configChanged) => { state.configChanged = fn; return disposable(); },
      onDidChangeWorkspaceFolders: (fn: typeof state.foldersChanged) => { state.foldersChanged = fn; return disposable(); },
    },
  };
});

// never touch the network from unit tests
vi.mock('../src/data/remotePricing', () => ({
  fetchRemotePricing: vi.fn(async () => { throw new Error('offline'); }),
  isRemotePricingStale: () => true,
  sanitizeRemotePricing: () => undefined,
}));

let context: { subscriptions: vscode.Disposable[]; globalState: { get: () => undefined; update: () => Promise<void> } };
afterEach(() => {
  for (const subscription of context?.subscriptions ?? []) subscription.dispose();
  vi.useRealTimers();
  vi.clearAllMocks();
  state.settings = {};
  state.folders = [];
  state.commands.clear();
});
function start() {
  context = { subscriptions: [], globalState: { get: () => undefined, update: async () => undefined } };
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

function remoteFolder() {
  return { uri: {
    scheme: 'vscode-remote', authority: 'ssh-remote+host',
    with: ({ path }: { path: string }) => ({
      toString: () => `vscode-remote://ssh-remote+host${path}`,
    }),
  } };
}
const addRemote = () => state.commands.get('copilotCostLens.addRemoteCopilotRoot')!();

it('verifies access and effective persistence before notifying remote setup success', async () => {
  state.folders = [remoteFolder()];
  state.input.mockResolvedValue('/sessions');
  state.stat.mockResolvedValue({ type: 2 });
  state.readDirectory.mockResolvedValue([]);
  state.update.mockImplementation(async (key: string, value: unknown) => { state.settings[key] = value; });
  start();
  await addRemote();
  const uri = 'vscode-remote://ssh-remote+host/sessions';
  expect(state.update).toHaveBeenLastCalledWith('remoteCopilotRoots', [uri], 1);
  expect(state.information).toHaveBeenCalledOnce();
  expect(state.warning).not.toHaveBeenCalled();
  await addRemote();
  expect(state.settings.remoteCopilotRoots).toEqual([uri]);
  const calls = state.refresh.mock.calls.length;
  state.foldersChanged!();
  expect(state.refresh).toHaveBeenCalledTimes(calls + 1);
});

it('reports a shadowed remote setting without a success notification', async () => {
  state.folders = [remoteFolder()];
  state.input.mockResolvedValue('/sessions');
  state.stat.mockResolvedValue({ type: 2 });
  state.readDirectory.mockResolvedValue([]);
  state.update.mockImplementation(async () => {});
  start();
  await addRemote();
  expect(state.information).not.toHaveBeenCalled();
  expect(state.warning).toHaveBeenCalledOnce();
  expect(state.log.mock.calls.flat().join()).toContain('effective remoteCopilotRoots');
});

it('logs cancellation and rejects disconnected, relative or inaccessible roots', async () => {
  start();
  await addRemote();
  expect(state.warning).toHaveBeenCalledOnce();
  expect(state.input).not.toHaveBeenCalled();
  state.folders = [remoteFolder()];
  state.input.mockResolvedValue(undefined);
  await addRemote();
  expect(state.log.mock.calls.flat().join()).toContain('cancelled');
  state.input.mockResolvedValue('~/.copilot/session-state');
  await addRemote();
  expect(state.stat).not.toHaveBeenCalled();
  state.input.mockResolvedValue('/sessions');
  state.stat.mockResolvedValue({ type: 2 });
  state.readDirectory.mockRejectedValue(new Error('permission denied'));
  await addRemote();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.information).not.toHaveBeenCalled();
});
