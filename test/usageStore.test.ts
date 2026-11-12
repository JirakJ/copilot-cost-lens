import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreConfig, UsageStore } from '../src/data/usageStore';
import * as jsonlSource from '../src/sources/jsonlSource';

// Never read the developer's real usage logs in tests.
vi.mock('../src/sources/storageRoots', async (original) => ({
  ...await original<typeof import('../src/sources/storageRoots')>(),
  detectStorageRoots: async (extra: string[]) => extra,
}));

let root: string;
let ws: string;
let config: StoreConfig;
let store: UsageStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-store-'));
  ws = path.join(root, 'workspace');
  await fs.mkdir(path.join(ws, 'chatSessions'), { recursive: true });
  await fs.mkdir(path.join(ws, 'GitHub.copilot-chat', 'transcripts'), { recursive: true });
  config = {
    extraStorageRoots: [root], repoAliases: {}, claudeCodeEnabled: false,
    copilotCliEnabled: false, codexEnabled: false, jetbrainsCopilotEnabled: false,
    estimationEnabled: true, charsPerToken: 4, pricing: {},
  };
  store = new UsageStore(config);
});
afterEach(async () => {
  store.dispose();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function session(name = 'session', chars = 40) {
  await fs.writeFile(path.join(ws, 'chatSessions', `${name}.json`), JSON.stringify({
    sessionId: name, creationDate: 1750000000000,
    requests: [{ message: 'x'.repeat(chars), modelId: 'gpt-5-mini' }],
  }));
}

it('invalidates token estimates when the character ratio changes', async () => {
  await session();
  expect((await store.refresh())[0]!.inputTokens).toBe(10);
  store.updateConfig({ ...config, charsPerToken: 2 });
  expect((await store.refresh())[0]!.inputTokens).toBe(20);
});

it('finishes with the latest configuration when it changes during a scan', async () => {
  await session();
  let changed = false;
  store.onDidChange(() => {
    if (!changed) {
      changed = true;
      store.updateConfig({ ...config, charsPerToken: 2 });
    }
  });
  const [first, second] = await Promise.all([store.refresh(), store.refresh()]);
  expect(first[0]!.inputTokens).toBe(20);
  expect(second).toBe(first);
});

it('does not cache a stale migration fallback when only the sibling JSON changes', async () => {
  await session();
  await fs.writeFile(path.join(ws, 'chatSessions', 'session.jsonl'), '{truncated');
  expect((await store.refresh())[0]!.inputTokens).toBe(10);
  await session('session', 80);
  expect((await store.refresh())[0]!.inputTokens).toBe(20);
});

it('isolates one failed file and rejects invalid counts and dates', async () => {
  const dir = path.join(ws, 'GitHub.copilot-chat', 'transcripts');
  for (const name of ['bad', 'good', 'invalid']) await fs.writeFile(path.join(dir, `${name}.jsonl`), '{}');
  const parse = vi.spyOn(jsonlSource, 'parseJsonlUsage');
  parse.mockImplementation(async (file) => {
    if (file.sessionId === 'bad') throw new Error('do not expose record content');
    return [{
      sessionId: file.sessionId, provider: 'copilot', workspaceStorageDir: ws,
      timestamp: file.sessionId === 'invalid' ? Number.MAX_VALUE : 1750000000000,
      model: 'constructor', inputTokens: 10, outputTokens: 0, cachedTokens: 0,
      cacheWriteTokens: 0, estimated: false,
    }];
  });
  expect((await store.refresh()).map((e) => e.sessionId)).toEqual(['good']);
  expect(store.getStats().errors).toHaveLength(2);
  expect(store.getStats().errors.join()).not.toContain('do not expose');
});

it('does not double count duplicate roots and releases removed file cache entries', async () => {
  await session();
  store.updateConfig({ ...config, extraStorageRoots: [root, root] });
  expect(await store.refresh()).toHaveLength(1);
  await fs.rm(path.join(ws, 'chatSessions', 'session.json'));
  expect(await store.refresh()).toHaveLength(0);
  expect((store as unknown as { fileCache: Map<string, unknown> }).fileCache.size).toBe(0);
});

it('does not publish or retain data after disposal during a scan', async () => {
  await session();
  const changed = vi.fn(() => store.dispose());
  store.onDidChange(changed);
  expect(await store.refresh()).toEqual([]);
  expect(await store.refresh()).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(1);
});

describe('Copilot Chat global-storage debug logs (#17)', () => {
  let base: string;
  let wsRoot: string;
  let wsA: string;
  let global: string;
  let s: UsageStore;
  const llm = (ts: number, inputTokens: number) => JSON.stringify({
    v: 1, ts, sid: 'x', type: 'llm_request', name: 'chat:gpt-5-mini',
    attrs: { model: 'gpt-5-mini', inputTokens, outputTokens: 5 },
  });
  const start = JSON.stringify({
    v: 1, ts: 1761000000000, type: 'session_start',
    attrs: { copilotVersion: '0.71.0', vscodeVersion: '1.143.1' },
  });
  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-global-'));
    wsRoot = path.join(base, 'User', 'workspaceStorage');
    wsA = path.join(wsRoot, 'a');
    global = path.join(base, 'User', 'globalStorage', 'github.copilot-chat');
    await fs.mkdir(path.join(wsA, 'chatSessions'), { recursive: true });
    await fs.writeFile(path.join(wsA, 'workspace.json'), JSON.stringify({ folder: 'file:///work/alpha' }));
    s = new UsageStore({ ...config, extraStorageRoots: [wsRoot] });
  });
  afterEach(async () => {
    s.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  async function globalLog(sessionId: string, file: string, lines: string[]) {
    const dir = path.join(global, 'debug-logs', sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, file), lines.join('\n') + '\n');
  }

  it('reads sessions logged after Copilot Chat moved debug logs to global storage', async () => {
    await fs.writeFile(path.join(wsA, 'chatSessions', 's1.json'), JSON.stringify({
      sessionId: 's1', creationDate: 1761000000000,
      requests: [{ message: 'x'.repeat(400), modelId: 'gpt-5-mini' }],
    }));
    await globalLog('s1', 'main.jsonl', [start, llm(1762000000000, 100)]);
    await globalLog('s1', 'runSubagent-child1.jsonl', [start, llm(1762000001000, 50)]);
    await fs.writeFile(path.join(global, 'debug-logs', 's1', 'models.json'), '[]');
    const events = await s.refresh();
    // exact global records win; the 100-token chatSessions estimate is dropped
    expect(events.map((e) => e.inputTokens)).toEqual([100, 50]);
    expect(events.every((e) => e.sessionId === 's1')).toBe(true);
    expect(events[0]!.repo.name).toBe('alpha');
    expect(s.getStats().newestTimestamp).toBe(1762000001000);
    expect(s.getStats().scannedRoots).toContain(global);
    expect(await s.getWatchDirs()).toContain(global);
  });

  it('does not count a session twice when it is logged in both locations', async () => {
    const dir = path.join(wsA, 'GitHub.copilot-chat', 'debug-logs', 's2');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'main.jsonl'), llm(1761500000000, 70) + '\n');
    await globalLog('s2', 'main.jsonl', [llm(1761500000000, 70)]);
    expect((await s.refresh()).map((e) => e.inputTokens)).toEqual([70]);
  });

  it('keeps a global session without a known workspace instead of dropping it', async () => {
    await globalLog('orphan', 'main.jsonl', [llm(1762000000000, 10)]);
    const events = await s.refresh();
    expect(events).toHaveLength(1);
    expect(events[0]!.repo.name).toBe('(unknown)');
  });
});
