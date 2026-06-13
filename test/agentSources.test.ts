import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClaudeCodeFiles, parseClaudeCodeUsage } from '../src/sources/claudeCodeSource';
import { findCopilotCliFiles, parseCopilotCliUsage } from '../src/sources/copilotCliSource';

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-lens-agents-'));

  // --- Claude Code fixture -------------------------------------------------
  const projectDir = path.join(root, 'claude-projects', '-Users-dev-work-acme');
  await fs.mkdir(projectDir, { recursive: true });
  const usage = {
    input_tokens: 3436,
    cache_creation_input_tokens: 3682,
    cache_read_input_tokens: 7912,
    output_tokens: 282,
  };
  await fs.writeFile(
    path.join(projectDir, 'sess-1.jsonl'),
    [
      JSON.stringify({ type: 'user', sessionId: 'sess-1', timestamp: '2026-06-10T10:00:00Z' }),
      // duplicated streaming record for the same message id — must count once
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        cwd: '/Users/dev/work/acme',
        timestamp: '2026-06-10T10:00:05Z',
        requestId: 'req_1',
        message: { id: 'msg_1', model: 'claude-fable-5', usage },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        cwd: '/Users/dev/work/acme',
        timestamp: '2026-06-10T10:00:06Z',
        requestId: 'req_1',
        message: { id: 'msg_1', model: 'claude-fable-5', usage },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        cwd: '/Users/dev/work/acme',
        timestamp: '2026-06-10T10:01:00Z',
        requestId: 'req_2',
        message: {
          id: 'msg_2',
          model: 'claude-opus-4-5-20251101',
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_3', model: '<synthetic>', usage: { input_tokens: 1 } } }),
    ].join('\n'),
  );

  // --- Copilot CLI fixtures ------------------------------------------------
  const cliRoot = path.join(root, 'copilot-session-state');
  const cliSession = path.join(cliRoot, 'cli-sess-1');
  await fs.mkdir(cliSession, { recursive: true });
  await fs.writeFile(
    path.join(cliSession, 'events.jsonl'),
    [
      JSON.stringify({
        type: 'session.start',
        timestamp: '2026-05-25T07:20:41Z',
        data: { sessionId: 'cli-sess-1', context: { cwd: '/Users/dev/work/acme', repository: 'acme/widgets' } },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: '2026-05-26T07:21:38Z',
        data: {
          totalPremiumRequests: 39,
          modelMetrics: {
            'claude-opus-4.6': {
              requests: { count: 163, cost: 39 },
              usage: { inputTokens: 13811348, outputTokens: 62581, cacheReadTokens: 13194526, cacheWriteTokens: 596103 },
              totalNanoAiu: 0,
            },
            'gpt-5.5': {
              requests: { count: 6, cost: 0 },
              usage: { inputTokens: 256592, outputTokens: 3169, cacheReadTokens: 189952, cacheWriteTokens: 0 },
              totalNanoAiu: 0,
            },
          },
        },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: '2026-05-27T01:28:17Z',
        data: {
          modelMetrics: {
            'claude-opus-4.6': {
              requests: { count: 60, cost: 15 },
              usage: { inputTokens: 5028462, outputTokens: 20000, cacheReadTokens: 4000000, cacheWriteTokens: 100000 },
              totalNanoAiu: 0,
            },
          },
        },
      }),
    ].join('\n'),
  );

  // session without shutdown → estimation fallback
  await fs.writeFile(
    path.join(cliRoot, 'cli-sess-2.jsonl'),
    [
      JSON.stringify({
        type: 'session.start',
        timestamp: '2026-06-01T08:00:00Z',
        data: { context: { cwd: '/Users/dev/work/beta' } },
      }),
      JSON.stringify({ type: 'session.model_change', timestamp: '2026-06-01T08:00:01Z', data: { model: 'gpt-5-mini' } }),
      JSON.stringify({ type: 'user.message', timestamp: '2026-06-01T08:00:02Z', data: { content: 'x'.repeat(400) } }),
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-06-01T08:00:10Z',
        data: { model: 'gpt-5-mini', content: 'hello', outputTokens: 1234 },
      }),
    ].join('\n'),
  );
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('claudeCodeSource', () => {
  it('parses exact usage and dedupes streamed duplicates', async () => {
    const files = await findClaudeCodeFiles(path.join(root, 'claude-projects'));
    expect(files).toHaveLength(1);
    const usages = await parseClaudeCodeUsage(files[0]!);

    // msg_1 deduped, msg_2 kept, synthetic dropped
    expect(usages).toHaveLength(2);
    const first = usages[0]!;
    expect(first.provider).toBe('claude-code');
    expect(first.folderPath).toBe('/Users/dev/work/acme');
    expect(first.inputTokens).toBe(3436);
    expect(first.cachedTokens).toBe(7912);
    expect(first.cacheWriteTokens).toBe(3682);
    expect(first.estimated).toBe(false);
  });
});

describe('copilotCliSource', () => {
  it('discovers both directory and flat layouts', async () => {
    const files = await findCopilotCliFiles(path.join(root, 'copilot-session-state'));
    expect(files.map((f) => f.sessionId).sort()).toEqual(['cli-sess-1', 'cli-sess-2']);
  });

  it('emits exact per-model usage for every shutdown', async () => {
    const files = await findCopilotCliFiles(path.join(root, 'copilot-session-state'));
    const session = files.find((f) => f.sessionId === 'cli-sess-1')!;
    const usages = await parseCopilotCliUsage(session, { charsPerToken: 4 });

    expect(usages).toHaveLength(3); // 2 models in run 1 + 1 model in run 2
    const opusRun1 = usages.find((u) => u.model === 'claude-opus-4.6' && u.premiumRequests === 39)!;
    expect(opusRun1.repoSlug).toBe('acme/widgets');
    // inputTokens normalized to fresh input: 13811348 total − 13194526 cache reads
    expect(opusRun1.inputTokens).toBe(13811348 - 13194526);
    expect(opusRun1.cachedTokens).toBe(13194526);
    expect(opusRun1.cacheWriteTokens).toBe(596103);
    expect(opusRun1.estimated).toBe(false);
    // gpt-5.5 had requests.cost 0 → priced from tokens, not premium requests
    const gpt = usages.find((u) => u.model === 'gpt-5.5')!;
    expect(gpt.premiumRequests).toBeUndefined();
  });

  it('falls back to estimation when a session never shut down', async () => {
    const files = await findCopilotCliFiles(path.join(root, 'copilot-session-state'));
    const session = files.find((f) => f.sessionId === 'cli-sess-2')!;
    const usages = await parseCopilotCliUsage(session, { charsPerToken: 4 });

    expect(usages).toHaveLength(1);
    const usage = usages[0]!;
    expect(usage.estimated).toBe(true);
    expect(usage.model).toBe('gpt-5-mini');
    expect(usage.inputTokens).toBe(100); // 400 chars / 4
    expect(usage.outputTokens).toBe(1234); // exact from the event
    expect(usage.folderPath).toBe('/Users/dev/work/beta');
  });
});
