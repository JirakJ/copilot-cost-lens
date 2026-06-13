import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { folderName, parseRemoteSlug, readGitRemoteSlug } from '../src/sources/workspaceIndex';

describe('parseRemoteSlug', () => {
  it('parses ssh remotes', () => {
    const config = '[remote "origin"]\n\turl = git@github.com:JirakJ/copilot-cost-lens.git\n';
    expect(parseRemoteSlug(config)).toBe('JirakJ/copilot-cost-lens');
  });

  it('parses https remotes', () => {
    const config = '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n';
    expect(parseRemoteSlug(config)).toBe('owner/repo');
  });

  it('parses remotes without .git suffix', () => {
    const config = '[remote "origin"]\n\turl = https://gitlab.com/group/project\n';
    expect(parseRemoteSlug(config)).toBe('group/project');
  });

  it('prefers origin over other remotes', () => {
    const config =
      '[remote "upstream"]\n\turl = git@github.com:other/upstream.git\n' +
      '[remote "origin"]\n\turl = git@github.com:owner/mine.git\n';
    expect(parseRemoteSlug(config)).toBe('owner/mine');
  });

  it('returns undefined without remotes', () => {
    expect(parseRemoteSlug('[core]\n\tbare = false\n')).toBeUndefined();
  });
});

describe('folderName', () => {
  it('uses the last meaningful segment', () => {
    expect(folderName('/Users/me/work/blog-2025')).toBe('blog-2025');
  });
  it('skips a trailing .git segment', () => {
    expect(folderName('/Users/me/work/repo/.git')).toBe('repo');
  });
  it('skips a Claude Code worktree slug and its scaffolding', () => {
    expect(folderName('/Users/me/work/myproj/.claude/worktrees/sleepy-mestorf-9e9b83')).toBe('myproj');
  });
});

describe('readGitRemoteSlug', () => {
  let root: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wi-test-'));
    // a normal repo
    const repo = path.join(root, 'repo');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    await fs.writeFile(path.join(repo, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:owner/repo.git\n');
    // a worktree: .git is a FILE pointing at <main>/.git/worktrees/<name>
    const wt = path.join(repo, '.claude', 'worktrees', 'sleepy-mestorf-9e9b83');
    await fs.mkdir(wt, { recursive: true });
    await fs.mkdir(path.join(repo, '.git', 'worktrees', 'sleepy-mestorf-9e9b83'), { recursive: true });
    await fs.writeFile(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'sleepy-mestorf-9e9b83')}\n`);
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads the remote from a normal repo', async () => {
    expect(await readGitRemoteSlug(path.join(root, 'repo'))).toBe('owner/repo');
  });

  it('follows a worktree .git file to the main repo remote', async () => {
    const wt = path.join(root, 'repo', '.claude', 'worktrees', 'sleepy-mestorf-9e9b83');
    expect(await readGitRemoteSlug(wt)).toBe('owner/repo');
  });
});
