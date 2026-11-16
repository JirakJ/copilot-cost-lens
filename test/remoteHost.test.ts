import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageStore } from '../src/data/usageStore';
import { detectStorageRoots, hostWorkspaceStorageRoot } from '../src/sources/storageRoots';
import { WorkspaceIndex } from '../src/sources/workspaceIndex';

// Remote development (SSH / WSL / dev container): Copilot Chat runs in the
// remote extension host and logs under the VS Code Server data folder (#17).
const ENV_KEYS = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME'] as const;
let home: string;
let saved: Record<string, string | undefined>;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-remote-'));
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
  delete process.env.XDG_CONFIG_HOME;
});
afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  await fs.rm(home, { recursive: true, force: true });
});

const serverRoot = (product = '.vscode-server') => path.join(home, product, 'data', 'User', 'workspaceStorage');

describe('VS Code Server storage (#17)', () => {
  it('detects the workspaceStorage of every known server variant', async () => {
    await fs.mkdir(serverRoot(), { recursive: true });
    await fs.mkdir(serverRoot('.vscode-server-insiders'), { recursive: true });
    await fs.mkdir(serverRoot('.cursor-server'), { recursive: true });
    const roots = await detectStorageRoots();
    expect(roots).toEqual(
      expect.arrayContaining([serverRoot(), serverRoot('.vscode-server-insiders'), serverRoot('.cursor-server')]),
    );
  });

  it('derives the workspaceStorage root from the extension global storage path', () => {
    const user = path.join(home, 'custom-data', 'User');
    expect(hostWorkspaceStorageRoot(path.join(user, 'globalStorage', 'jakubjirak.copilot-cost-lens'))).toBe(
      path.join(user, 'workspaceStorage'),
    );
  });

  it('names a remote workspace after meta.json when there is no workspace.json', async () => {
    const wsDir = path.join(serverRoot(), '0123456789abcdef');
    await fs.mkdir(wsDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, 'meta.json'), JSON.stringify({ id: '0123456789abcdef', name: 'alpha' }));
    expect(await new WorkspaceIndex().resolve(wsDir)).toEqual({ name: 'alpha' });
  });

  it('reads Copilot Chat logs written on a remote host and attributes them to the workspace', async () => {
    const wsDir = path.join(serverRoot(), '0123456789abcdef');
    const logDir = path.join(wsDir, 'GitHub.copilot-chat', 'debug-logs', 's1');
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(wsDir, 'meta.json'), JSON.stringify({ id: '0123456789abcdef', name: 'alpha' }));
    await fs.writeFile(
      path.join(logDir, 'main.jsonl'),
      JSON.stringify({
        v: 1, ts: 1762000000000, sid: 's1', type: 'llm_request', name: 'chat:gpt-5-mini',
        attrs: { model: 'gpt-5-mini', inputTokens: 100, outputTokens: 5 },
      }) + '\n',
    );
    const store = new UsageStore({
      extraStorageRoots: [], repoAliases: {}, claudeCodeEnabled: false, copilotCliEnabled: false,
      codexEnabled: false, jetbrainsCopilotEnabled: false, estimationEnabled: true, charsPerToken: 4, pricing: {},
    });
    try {
      const events = await store.refresh();
      expect(events.map((e) => [e.inputTokens, e.repo.name])).toEqual([[100, 'alpha']]);
      expect(await store.getWatchDirs()).toContain(serverRoot());
    } finally {
      store.dispose();
    }
  });
});
