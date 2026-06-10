import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RepoRef } from '../types';

/**
 * Resolves a workspaceStorage directory to a repository identity:
 * workspace.json → folder URI → git remote slug (or folder name).
 * Results are cached per storage directory.
 */
export class WorkspaceIndex {
  private cache = new Map<string, RepoRef>();

  async resolve(workspaceStorageDir: string): Promise<RepoRef> {
    const cached = this.cache.get(workspaceStorageDir);
    if (cached) {
      return cached;
    }
    const ref = await this.resolveUncached(workspaceStorageDir);
    this.cache.set(workspaceStorageDir, ref);
    return ref;
  }

  /** Resolve a plain workspace folder path (Claude Code / Copilot CLI cwd). */
  async resolveFolder(folderPath: string): Promise<RepoRef> {
    const key = `folder:${folderPath}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const remoteSlug = await readGitRemoteSlug(folderPath);
    const ref: RepoRef = {
      name: remoteSlug ?? path.basename(folderPath),
      folderPath,
      remoteSlug,
    };
    this.cache.set(key, ref);
    return ref;
  }

  private async resolveUncached(workspaceStorageDir: string): Promise<RepoRef> {
    const folderPath = await readWorkspaceFolder(workspaceStorageDir);
    if (!folderPath) {
      return { name: `(unknown) ${path.basename(workspaceStorageDir).slice(0, 8)}` };
    }
    const remoteSlug = await readGitRemoteSlug(folderPath);
    return {
      name: remoteSlug ?? path.basename(folderPath),
      folderPath,
      remoteSlug,
    };
  }
}

/** Parse workspace.json and return the local folder path it points to. */
export async function readWorkspaceFolder(workspaceStorageDir: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(workspaceStorageDir, 'workspace.json'), 'utf8');
    const parsed = JSON.parse(raw) as { folder?: string; workspace?: string; configuration?: string };
    const uri = parsed.folder ?? parsed.workspace ?? parsed.configuration;
    if (!uri || !uri.startsWith('file://')) {
      return undefined;
    }
    const fsPath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
    // Windows: file:///c%3A/dev/repo → /c:/dev/repo → c:/dev/repo
    const normalized = /^\/[a-zA-Z]:\//.test(fsPath) ? fsPath.slice(1) : fsPath;
    return normalized.replace(/\.code-workspace$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Extract an "owner/repo" slug from .git/config of the workspace folder.
 * Pure file read — no git binary involved.
 */
export async function readGitRemoteSlug(folderPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(folderPath, '.git', 'config'), 'utf8');
    return parseRemoteSlug(raw);
  } catch {
    return undefined;
  }
}

/** Parse the first remote URL out of git config text and reduce it to owner/repo. */
export function parseRemoteSlug(gitConfig: string): string | undefined {
  const originSection = /\[remote "origin"\][^[]*/.exec(gitConfig)?.[0];
  const anyUrl = /url\s*=\s*(.+)/.exec(originSection ?? gitConfig)?.[1]?.trim();
  if (!anyUrl) {
    return undefined;
  }
  // git@github.com:owner/repo.git | https://github.com/owner/repo.git | ssh://git@host/owner/repo
  const match = /(?:[:/])([^:/]+\/[^:/]+?)(?:\.git)?\/?$/.exec(anyUrl);
  return match?.[1];
}
