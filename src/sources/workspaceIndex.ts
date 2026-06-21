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
    const ref = await refForFolder(folderPath);
    this.cache.set(key, ref);
    return ref;
  }

  private async resolveUncached(workspaceStorageDir: string): Promise<RepoRef> {
    const folderPath = await readWorkspaceFolder(workspaceStorageDir);
    if (!folderPath) {
      return { name: `(unknown) ${path.basename(workspaceStorageDir).slice(0, 8)}` };
    }
    return refForFolder(folderPath);
  }
}

/**
 * Build a repository identity from any path that may sit *inside* a repo.
 * Anchors to the enclosing git repository root, so a working directory that
 * points at a sub-path (a `.git/info` cwd, a nested package folder, …) is
 * attributed to the repository itself instead of producing a separate bucket
 * named after the sub-folder. Falls back to the path as given when it is not
 * inside any repository.
 */
export async function refForFolder(folderPath: string): Promise<RepoRef> {
  const root = (await findRepoRoot(folderPath)) ?? folderPath;
  const remoteSlug = await readGitRemoteSlug(root);
  return {
    name: remoteSlug ?? folderName(root),
    folderPath: root,
    remoteSlug,
  };
}

/** Nearest ancestor (inclusive) that holds a `.git` entry — the repo root. */
export async function findRepoRoot(folderPath: string): Promise<string | undefined> {
  let dir = folderPath;
  for (let depth = 0; depth < 40 && dir && dir !== path.dirname(dir); depth++) {
    if (await pathExists(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
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
 * Extract an "owner/repo" slug from the git config of the workspace folder.
 * Pure file read — no git binary involved. Handles git worktrees, where
 * `<folder>/.git` is a file ("gitdir: …/.git/worktrees/<name>") rather than a
 * directory, so the remote lives in the main repo's config.
 */
export async function readGitRemoteSlug(folderPath: string): Promise<string | undefined> {
  const configPath = await resolveGitConfigPath(folderPath);
  if (!configPath) {
    return undefined;
  }
  try {
    return parseRemoteSlug(await fs.readFile(configPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Locate the git config that holds the remotes, following a worktree pointer. */
async function resolveGitConfigPath(folderPath: string): Promise<string | undefined> {
  const dotGit = path.join(folderPath, '.git');
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) {
      return path.join(dotGit, 'config');
    }
    // worktree / submodule: .git is a file → "gitdir: <path-to-real-gitdir>"
    const pointer = await fs.readFile(dotGit, 'utf8');
    const gitdir = /gitdir:\s*(.+)/.exec(pointer)?.[1]?.trim();
    if (!gitdir) {
      return undefined;
    }
    const absGitdir = path.isAbsolute(gitdir) ? gitdir : path.resolve(folderPath, gitdir);
    // a worktree gitdir is "<main>/.git/worktrees/<name>"; remotes live in
    // "<main>/.git/config" — the commondir two levels up
    const wtIndex = absGitdir.lastIndexOf(`${path.sep}worktrees${path.sep}`);
    const commonDir = wtIndex >= 0 ? absGitdir.slice(0, wtIndex) : absGitdir;
    return path.join(commonDir, 'config');
  } catch {
    return undefined;
  }
}

/**
 * A human-readable folder name when there's no git remote. Skips meaningless
 * basenames (".git", a worktree dir, empty) by walking up to a real name.
 */
export function folderName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    // skip ".git" and the throwaway "<repo>/.claude/worktrees/<slug>" segments
    if (part === '.git' || part === 'worktrees' || part === '.claude') {
      continue;
    }
    // a worktree slug sits directly under ".../.claude/worktrees/"
    if (parts[i - 1] === 'worktrees') {
      continue;
    }
    return part;
  }
  return parts[parts.length - 1] ?? folderPath;
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
