import * as path from 'node:path';
import * as vscode from 'vscode';
import { RawUsage } from '../types';
import { parseCopilotCliUsage } from './copilotCliSource';
import { readJsonlChunks } from './jsonl';

export const MAX_REMOTE_FILE_BYTES = 64 * 1024 * 1024;

export interface RemoteCopilotScan {
  scannedRoots: string[];
  files: { uri: string; usages: RawUsage[] }[];
  errors: string[];
}

export interface RemoteCopilotReader {
  scan(roots: string[], charsPerToken: number): Promise<RemoteCopilotScan>;
  dispose(): void;
}

/** Only explicitly configured roots on a connection already open in this window. */
export function remoteCopilotRoot(value: string): vscode.Uri {
  const uri = vscode.Uri.parse(value, true);
  if (uri.scheme !== 'vscode-remote' || !uri.authority || uri.query || uri.fragment ||
      !uri.path.startsWith('/')) {
    throw new Error('Expected an absolute vscode-remote URI without query or fragment');
  }
  return uri;
}

export class VscodeRemoteCopilotReader implements RemoteCopilotReader {
  private cache = new Map<string, { fingerprint: string; usages: RawUsage[] }>();
  private disposed = false;

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }

  async scan(roots: string[], charsPerToken: number): Promise<RemoteCopilotScan> {
    const result: RemoteCopilotScan = { scannedRoots: [], files: [], errors: [] };
    const authorities = new Set(
      (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => folder.uri.scheme === 'vscode-remote' && folder.uri.authority)
        .map((folder) => folder.uri.authority),
    );
    const seen = new Set<string>();
    const scanned = new Set<string>();
    const failure = (uri: string, error: unknown) => {
      const reason = error instanceof RangeError ? '64 MiB size limit exceeded'
        : error instanceof Error ? error.name : 'Error';
      result.errors.push(`Could not read remote ${uri} (${reason})`);
    };
    const read = async (uri: vscode.Uri, sessionId: string) => {
      const key = uri.toString();
      if (seen.has(key) || this.disposed) return;
      seen.add(key);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (!(stat.type & vscode.FileType.File)) throw new Error('Expected a file');
        if (stat.size > MAX_REMOTE_FILE_BYTES) throw new RangeError('Remote file exceeds 64 MiB');
        const fingerprint = `${stat.mtime}:${stat.size}:${charsPerToken}`;
        let cached = this.cache.get(key);
        if (cached?.fingerprint !== fingerprint) {
          this.cache.delete(key);
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > MAX_REMOTE_FILE_BYTES) throw new RangeError('Remote file exceeds 64 MiB');
          const usages = await parseCopilotCliUsage(
            { filePath: key, sessionId }, { charsPerToken },
            (_file, onRecord) => readJsonlChunks(
              [Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8')], onRecord,
            ),
          );
          for (const usage of usages) {
            const name = usage.repoSlug ?? (usage.folderPath
              ? path.posix.basename(usage.folderPath.replace(/\\/g, '/').replace(/\/+$/, ''))
              : undefined);
            usage.repo = { name: name || '(unknown)', remoteSlug: usage.repoSlug };
            usage.folderPath = undefined;
            usage.workspaceStorageDir = undefined;
          }
          cached = { fingerprint, usages };
          if (!this.disposed) this.cache.set(key, cached);
        }
        if (!this.disposed) result.files.push({ uri: key, usages: cached.usages });
      } catch (error) {
        this.cache.delete(key);
        // Session directories can exist before their event log is created.
        if (!isMissing(error)) failure(key, error);
      }
    };
    for (const value of roots) {
      if (this.disposed) break;
      try {
        const root = remoteCopilotRoot(value);
        if (!authorities.has(root.authority)) throw new Error('Remote authority is not connected in this window');
        const key = root.toString();
        if (scanned.has(key)) continue;
        scanned.add(key);
        result.scannedRoots.push(key);
        for (const [name, type] of await vscode.workspace.fs.readDirectory(root)) {
          if (type & vscode.FileType.Directory) {
            await read(vscode.Uri.joinPath(root, name, 'events.jsonl'), name);
          } else if ((type & vscode.FileType.File) && name.endsWith('.jsonl')) {
            await read(vscode.Uri.joinPath(root, name), name.slice(0, -6));
          }
        }
      } catch (error) {
        failure(value, error);
      }
    }
    for (const key of this.cache.keys()) {
      if (!seen.has(key)) this.cache.delete(key);
    }
    return result;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
