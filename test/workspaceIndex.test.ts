import { describe, expect, it } from 'vitest';
import { parseRemoteSlug } from '../src/sources/workspaceIndex';

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
