import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findCodexFiles, parseCodexUsage } from '../src/sources/codexSource';

let root: string | undefined;

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('codexSource', () => {
  it('discovers nested rollouts and parses exact request tokens', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-lens-codex-'));
    const dir = path.join(root, '2026', '07', '12');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'rollout-session-1.jsonl');
    await fs.writeFile(file, [
      JSON.stringify({ timestamp: '2026-07-12T08:00:00Z', type: 'session_meta', payload: { id: 'session-1', cwd: '/Users/dev/work/acme' } }),
      JSON.stringify({ timestamp: '2026-07-12T08:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.3-codex', cwd: '/Users/dev/work/acme' } }),
      JSON.stringify({ timestamp: '2026-07-12T08:00:05Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1200, cached_input_tokens: 900, output_tokens: 80, reasoning_output_tokens: 20, total_tokens: 1280 } } } }),
      JSON.stringify({ timestamp: '2026-07-12T08:00:06Z', type: 'event_msg', payload: { type: 'agent_message' } }),
    ].join('\n'));

    expect(await findCodexFiles(root)).toEqual([file]);
    expect(await parseCodexUsage(file)).toEqual([expect.objectContaining({
      sessionId: 'session-1', provider: 'codex', folderPath: '/Users/dev/work/acme',
      model: 'gpt-5.3-codex', inputTokens: 300, cachedTokens: 900,
      outputTokens: 80, cacheWriteTokens: 0, estimated: false,
    })]);
  });

  it('ignores cumulative counts without last-request usage', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-lens-codex-'));
    const file = path.join(root, 'rollout.jsonl');
    await fs.writeFile(file, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500 } } } }));
    expect(await parseCodexUsage(file)).toEqual([]);
  });
});
