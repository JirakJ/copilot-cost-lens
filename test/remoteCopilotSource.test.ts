import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { MAX_REMOTE_FILE_BYTES, VscodeRemoteCopilotReader } from '../src/sources/remoteCopilotSource';

const state = vi.hoisted(() => ({
  folders: [] as { uri: { scheme: string; authority: string } }[],
  entries: new Map<string, { bytes?: Uint8Array; size?: number; mtime?: number; directory?: [string, number][]; error?: Error }>(),
  stat: vi.fn(), readFile: vi.fn(), readDirectory: vi.fn(),
}));

vi.mock('vscode', () => {
  class Uri {
    constructor(public scheme: string, public authority: string, public path: string, public query = '', public fragment = '') {}
    static parse(value: string) {
      const url = new URL(value);
      return new Uri(url.protocol.slice(0, -1), url.host, decodeURIComponent(url.pathname), url.search.slice(1), url.hash.slice(1));
    }
    static joinPath(uri: Uri, ...parts: string[]) {
      return new Uri(uri.scheme, uri.authority, [uri.path.replace(/\/$/, ''), ...parts].join('/'));
    }
    toString() { return `${this.scheme}://${this.authority}${encodeURI(this.path)}${this.query ? '?' + this.query : ''}${this.fragment ? '#' + this.fragment : ''}`; }
  }
  class FileSystemError extends Error {
    constructor(public code: string) { super(code); }
  }
  return {
    Uri, FileSystemError, FileType: { File: 1, Directory: 2 },
    workspace: {
      get workspaceFolders() { return state.folders; },
      fs: { stat: state.stat, readFile: state.readFile, readDirectory: state.readDirectory },
    },
  };
});

const root = 'vscode-remote://ssh-remote+host/sessions';
const log = (id: string, context = { repository: 'acme/widgets', cwd: '/remote/widgets' }) => Buffer.from([
  { type: 'session.start', data: { selectedModel: 'gpt-5-mini', context } },
  { type: 'session.usage_record', id, timestamp: '2026-06-01T10:00:00Z',
    data: { usage: { inputTokens: 100, outputTokens: 20 } } },
].map((record) => JSON.stringify(record)).join('\n'));

beforeEach(() => {
  vi.resetAllMocks();
  state.entries.clear();
  state.folders = [{ uri: vscode.Uri.parse(root) }];
  const get = (uri: vscode.Uri) => {
    const entry = state.entries.get(uri.toString());
    if (!entry) {
      // The fake preserves VS Code's typed missing-file errors.
      throw new vscode.FileSystemError('FileNotFound');
    }
    if (entry.error) throw entry.error;
    return entry;
  };
  state.stat.mockImplementation(async (uri: vscode.Uri) => {
    const entry = get(uri);
    return { type: entry.directory ? 2 : 1, mtime: entry.mtime ?? 1, size: entry.size ?? entry.bytes?.byteLength ?? 0 };
  });
  state.readFile.mockImplementation(async (uri: vscode.Uri) => get(uri).bytes);
  state.readDirectory.mockImplementation(async (uri: vscode.Uri) => get(uri).directory);
  state.entries.set(root, { directory: [['flat.jsonl', 1], ['nested', 2], ['pending', 2], ['ignore.txt', 1]] });
  state.entries.set(`${root}/flat.jsonl`, { bytes: log('flat') });
  state.entries.set(`${root}/nested/events.jsonl`, { bytes: log('nested', { repository: '', cwd: '/remote/project/' }) });
});

it('discovers both layouts, tolerates missing event logs and clears remote paths', async () => {
  const reader = new VscodeRemoteCopilotReader();
  const scan = await reader.scan([root, root], 4);
  expect(scan.errors).toEqual([]);
  expect(scan.scannedRoots).toEqual([root]);
  expect(scan.files.map((file) => file.usages[0]!.sessionId)).toEqual(['flat', 'nested']);
  expect(scan.files[0]!.usages[0]).toMatchObject({ repo: { name: 'acme/widgets', remoteSlug: 'acme/widgets' }, estimated: false });
  expect(scan.files[1]!.usages[0]!.repo).toMatchObject({ name: 'project' });
  expect(scan.files.every((file) => file.usages.every((usage) =>
    !usage.folderPath && !usage.workspaceStorageDir && !usage.repo?.folderPath))).toBe(true);
});

it('rejects invalid roots and authorities outside this window without filesystem access', async () => {
  const scan = await new VscodeRemoteCopilotReader().scan([
    'file:///sessions', 'vscode-remote:/sessions', root + '?secret=1', root + '#fragment',
    'vscode-remote://ssh-remote+other/sessions',
  ], 4);
  expect(scan.errors).toHaveLength(5);
  expect(state.readDirectory).not.toHaveBeenCalled();
  expect(state.stat).not.toHaveBeenCalled();
  expect(state.readFile).not.toHaveBeenCalled();
});

it('isolates failed files and enforces advertised and actual transfer limits', async () => {
  state.entries.set(root, { directory: [['advertised.jsonl', 1], ['actual.jsonl', 1], ['bad.jsonl', 1], ['flat.jsonl', 1]] });
  state.entries.set(`${root}/advertised.jsonl`, { size: MAX_REMOTE_FILE_BYTES + 1, bytes: log('large') });
  state.entries.set(`${root}/actual.jsonl`, { size: 1, bytes: new Uint8Array(MAX_REMOTE_FILE_BYTES + 1) });
  state.entries.set(`${root}/bad.jsonl`, { error: new Error('private log content') });
  state.entries.get(`${root}/flat.jsonl`)!.size = MAX_REMOTE_FILE_BYTES;
  const scan = await new VscodeRemoteCopilotReader().scan([root], 4);
  expect(scan.errors).toHaveLength(3);
  expect(scan.errors.filter((error) => error.includes('64 MiB'))).toHaveLength(2);
  expect(scan.errors.join()).not.toContain('private log content');
  expect(scan.files).toHaveLength(1);
  expect(state.readFile.mock.calls.map(([uri]) => uri.toString())).not.toContain(`${root}/advertised.jsonl`);
});

it('caches by URI, mtime, size and ratio, evicts failures/removals and clears on disposal', async () => {
  const reader = new VscodeRemoteCopilotReader();
  await reader.scan([root], 4);
  await reader.scan([root], 4);
  expect(state.readFile).toHaveBeenCalledTimes(2);
  state.entries.get(`${root}/flat.jsonl`)!.mtime = 2;
  await reader.scan([root], 4);
  expect(state.readFile).toHaveBeenCalledTimes(3);
  const entry = state.entries.get(`${root}/flat.jsonl`)!;
  entry.bytes = Buffer.concat([entry.bytes!, Buffer.from('\n')]);
  await reader.scan([root], 4);
  expect(state.readFile).toHaveBeenCalledTimes(4);
  await reader.scan([root], 2);
  expect(state.readFile).toHaveBeenCalledTimes(6);
  entry.error = new Error('temporarily unavailable');
  expect((await reader.scan([root], 2)).files).toHaveLength(1);
  delete entry.error;
  await reader.scan([root], 2);
  expect(state.readFile).toHaveBeenCalledTimes(7);
  state.folders = [];
  expect((await reader.scan([root], 2)).errors).toHaveLength(1);
  state.folders = [{ uri: vscode.Uri.parse(root) }];
  await reader.scan([root], 2);
  expect(state.readFile).toHaveBeenCalledTimes(9);
  await reader.scan([], 2);
  await reader.scan([root], 2);
  expect(state.readFile).toHaveBeenCalledTimes(11);
  reader.dispose();
  expect((await reader.scan([root], 2)).files).toEqual([]);
});
