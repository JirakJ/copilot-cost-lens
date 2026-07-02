import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChatSessionFiles, parseChatSessionUsage } from '../src/sources/chatSessionSource';
import { findJsonlFiles, parseJsonlUsage } from '../src/sources/jsonlSource';
import { dedupeBySession } from '../src/data/usageStore';
import { RawUsage } from '../src/types';

let wsDir: string;

beforeAll(async () => {
  wsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-lens-test-'));

  // JSONL debug log fixture (one llm_request with billed credits, one noise line, one broken line)
  const debugDir = path.join(wsDir, 'GitHub.copilot-chat', 'debug-logs', 'session-abc');
  await fs.mkdir(debugDir, { recursive: true });
  await fs.writeFile(
    path.join(debugDir, 'main.jsonl'),
    [
      JSON.stringify({ type: 'user_message', spanId: 'u1', ts: 1750000000, attrs: { content: 'hi' } }),
      JSON.stringify({
        type: 'llm_request',
        parentSpanId: 'u1',
        ts: 1750000010,
        attrs: {
          model: 'copilot/gpt-5.3-codex',
          inputTokens: 12000,
          outputTokens: 3000,
          cachedTokens: 8000,
          copilotUsageNanoAiu: 1_200_000_000,
        },
      }),
      '{ broken json',
      '',
    ].join('\n'),
  );

  // Transcript fixture with flat usage fields
  const transcriptsDir = path.join(wsDir, 'GitHub.copilot-chat', 'transcripts');
  await fs.mkdir(transcriptsDir, { recursive: true });
  await fs.writeFile(
    path.join(transcriptsDir, 'session-def.jsonl'),
    JSON.stringify({ timestamp: '2026-06-09T10:00:00Z', usage_model: 'claude-sonnet-4.6', usage_input_tokens: 500, usage_output_tokens: 100 }) + '\n',
  );

  // Chat session fixture (no token data → estimation)
  const chatDir = path.join(wsDir, 'chatSessions');
  await fs.mkdir(chatDir, { recursive: true });
  await fs.writeFile(
    path.join(chatDir, 'session-abc.json'),
    JSON.stringify({
      version: 3,
      sessionId: 'session-abc',
      creationDate: 1750000000000,
      requests: [
        {
          modelId: 'copilot/gpt-5.3-codex',
          timestamp: 1750000005000,
          message: { text: 'x'.repeat(400) },
          response: [{ value: 'y'.repeat(2000) }],
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(chatDir, 'session-xyz.json'),
    JSON.stringify({
      version: 3,
      sessionId: 'session-xyz',
      creationDate: 1750100000000,
      requests: [
        { modelId: 'gpt-5-mini', timestamp: 1750100005000, message: { text: 'short' }, response: [{ value: 'answer '.repeat(50) }] },
        { message: {}, response: [] },
      ],
    }),
  );

  // Log-store fixture (.jsonl mutation log, VS Code ≥1.128): initial state,
  // streaming patches with exact usage, a second request pushed later,
  // a set+delete pair and a broken line.
  await fs.writeFile(
    path.join(chatDir, 'session-log.jsonl'),
    [
      JSON.stringify({
        kind: 0,
        v: {
          version: 3,
          sessionId: 'session-log',
          creationDate: 1750200000000,
          requests: [
            { requestId: 'r1', modelId: 'copilot/gpt-5.3-codex', timestamp: 1750200005000, message: { text: 'question' }, response: [] },
          ],
        },
      }),
      JSON.stringify({ kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'partial answer' }] }),
      JSON.stringify({ kind: 1, k: ['requests', 0, 'promptTokens'], v: 12345 }),
      JSON.stringify({ kind: 1, k: ['requests', 0, 'completionTokens'], v: 678 }),
      JSON.stringify({ kind: 1, k: ['requests', 0, 'copilotCredits'], v: 1.5 }),
      JSON.stringify({
        kind: 2,
        k: ['requests'],
        v: [{ requestId: 'r2', modelId: 'gpt-5-mini', timestamp: 1750200010000, message: { text: 'x'.repeat(400) }, response: [{ value: 'y'.repeat(2000) }] }],
      }),
      JSON.stringify({ kind: 1, k: ['customTitle'], v: 'title' }),
      JSON.stringify({ kind: 3, k: ['customTitle'] }),
      '{ broken json',
      '',
    ].join('\n'),
  );

  // Same session in both formats → only the .jsonl must be read
  await fs.writeFile(
    path.join(chatDir, 'session-dup.json'),
    JSON.stringify({ sessionId: 'session-dup', requests: [{ modelId: 'gpt-5-mini', message: { text: 'stale flat copy' }, response: [] }] }),
  );
  await fs.writeFile(
    path.join(chatDir, 'session-dup.jsonl'),
    JSON.stringify({
      kind: 0,
      v: {
        sessionId: 'session-dup',
        creationDate: 1750300000000,
        requests: [{ requestId: 'r1', modelId: 'gpt-5-mini', timestamp: 1750300005000, promptTokens: 100, completionTokens: 50 }],
      },
    }) + '\n',
  );
});

afterAll(async () => {
  await fs.rm(wsDir, { recursive: true, force: true });
});

describe('jsonlSource', () => {
  it('discovers transcripts and debug logs with session ids', async () => {
    const files = await findJsonlFiles(wsDir);
    const ids = files.map((f) => f.sessionId).sort();
    expect(ids).toEqual(['session-abc', 'session-def']);
  });

  it('parses usage records and tolerates malformed lines', async () => {
    const files = await findJsonlFiles(wsDir);
    const debug = files.find((f) => f.sessionId === 'session-abc')!;
    const usages = await parseJsonlUsage(debug, wsDir);
    expect(usages).toHaveLength(1);
    const usage = usages[0]!;
    expect(usage.model).toBe('copilot/gpt-5.3-codex');
    // inputTokens normalized to fresh: 12000 total − 8000 cache reads
    expect(usage.inputTokens).toBe(4000);
    expect(usage.cachedTokens).toBe(8000);
    expect(usage.nanoCredits).toBe(1_200_000_000);
    expect(usage.timestamp).toBe(1750000010000); // seconds → ms
    expect(usage.estimated).toBe(false);
  });

  it('reads flat snake_case usage fields from transcripts', async () => {
    const files = await findJsonlFiles(wsDir);
    const transcript = files.find((f) => f.sessionId === 'session-def')!;
    const usages = await parseJsonlUsage(transcript, wsDir);
    expect(usages).toHaveLength(1);
    expect(usages[0]!.model).toBe('claude-sonnet-4.6');
    expect(usages[0]!.inputTokens).toBe(500);
    expect(usages[0]!.nanoCredits).toBeUndefined();
  });
});

describe('chatSessionSource', () => {
  it('discovers .json and .jsonl sessions, preferring .jsonl for the same id', async () => {
    const files = await findChatSessionFiles(wsDir);
    const names = files.map((f) => path.basename(f)).sort();
    expect(names).toEqual(['session-abc.json', 'session-dup.jsonl', 'session-log.jsonl', 'session-xyz.json']);
  });

  it('replays the .jsonl mutation log and reads exact usage', async () => {
    const files = await findChatSessionFiles(wsDir);
    const log = files.find((f) => f.endsWith('session-log.jsonl'))!;
    const usages = await parseChatSessionUsage(log, wsDir, { charsPerToken: 4 });
    expect(usages).toHaveLength(2);

    // request 1: exact usage patched in via Set operations
    expect(usages[0]!.model).toBe('copilot/gpt-5.3-codex');
    expect(usages[0]!.inputTokens).toBe(12345);
    expect(usages[0]!.outputTokens).toBe(678);
    expect(usages[0]!.nanoCredits).toBe(1_500_000_000);
    expect(usages[0]!.timestamp).toBe(1750200005000);
    expect(usages[0]!.estimated).toBe(true); // stays droppable vs exact extension logs

    // request 2: pushed later, no usage fields → content-length estimate
    expect(usages[1]!.model).toBe('gpt-5-mini');
    expect(usages[1]!.inputTokens).toBe(100); // 400 chars / 4
    expect(usages[1]!.nanoCredits).toBeUndefined();
  });

  it('falls back to the sibling .json when the .jsonl is empty or corrupt', async () => {
    const dir = path.join(wsDir, 'chatSessions');
    await fs.writeFile(path.join(dir, 'session-broken.jsonl'), '{ truncated first li');
    await fs.writeFile(
      path.join(dir, 'session-broken.json'),
      JSON.stringify({
        sessionId: 'session-broken',
        creationDate: 1750400000000,
        requests: [{ modelId: 'gpt-5-mini', timestamp: 1750400005000, message: { text: 'x'.repeat(40) }, response: [{ value: 'y'.repeat(40) }] }],
      }),
    );
    try {
      const usages = await parseChatSessionUsage(path.join(dir, 'session-broken.jsonl'), wsDir, { charsPerToken: 4 });
      expect(usages).toHaveLength(1);
      expect(usages[0]!.sessionId).toBe('session-broken');
      expect(usages[0]!.inputTokens).toBe(10);
    } finally {
      await fs.rm(path.join(dir, 'session-broken.jsonl'));
      await fs.rm(path.join(dir, 'session-broken.json'));
    }
  });

  it('ignores corrupt array-growth operations instead of building huge sparse arrays', async () => {
    const dir = path.join(wsDir, 'chatSessions');
    const file = path.join(dir, 'session-evil.jsonl');
    await fs.writeFile(
      file,
      [
        JSON.stringify({
          kind: 0,
          v: {
            sessionId: 'session-evil',
            creationDate: 1750500000000,
            requests: [{ requestId: 'r1', modelId: 'gpt-5-mini', timestamp: 1750500005000, promptTokens: 10, completionTokens: 5 }],
          },
        }),
        JSON.stringify({ kind: 2, k: ['requests'], i: 500_000_000 }), // growth via truncate index
        JSON.stringify({ kind: 1, k: ['requests', 'length'], v: 500_000_000 }), // growth via length set
        '',
      ].join('\n'),
    );
    try {
      const started = Date.now();
      const usages = await parseChatSessionUsage(file, wsDir, { charsPerToken: 4 });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(usages).toHaveLength(1);
      expect(usages[0]!.inputTokens).toBe(10);
    } finally {
      await fs.rm(file);
    }
  });

  it('reads the .jsonl copy when a session exists in both formats', async () => {
    const files = await findChatSessionFiles(wsDir);
    const dup = files.find((f) => f.endsWith('session-dup.jsonl'))!;
    const usages = await parseChatSessionUsage(dup, wsDir, { charsPerToken: 4 });
    expect(usages).toHaveLength(1);
    expect(usages[0]!.sessionId).toBe('session-dup');
    expect(usages[0]!.inputTokens).toBe(100);
    expect(usages[0]!.outputTokens).toBe(50);
    expect(usages[0]!.nanoCredits).toBeUndefined();
  });

  it('estimates tokens from content length', async () => {
    const files = await findChatSessionFiles(wsDir);
    const abc = files.find((f) => f.endsWith('session-abc.json'))!;
    const usages = await parseChatSessionUsage(abc, wsDir, { charsPerToken: 4 });
    expect(usages).toHaveLength(1);
    expect(usages[0]!.inputTokens).toBe(100); // 400 chars / 4
    expect(usages[0]!.outputTokens).toBeGreaterThanOrEqual(500);
    expect(usages[0]!.estimated).toBe(true);
  });

  it('skips requests without content', async () => {
    const files = await findChatSessionFiles(wsDir);
    const xyz = files.find((f) => f.endsWith('session-xyz.json'))!;
    const usages = await parseChatSessionUsage(xyz, wsDir, { charsPerToken: 4 });
    expect(usages).toHaveLength(1);
  });
});

describe('dedupeBySession', () => {
  const mk = (sessionId: string, estimated: boolean): RawUsage => ({
    sessionId,
    provider: 'copilot',
    workspaceStorageDir: wsDir,
    timestamp: 1,
    model: 'gpt-5-mini',
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    estimated,
  });

  it('drops estimates for sessions that have exact data', () => {
    const merged = dedupeBySession([mk('a', false)], [mk('a', true), mk('b', true)]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((u) => u.sessionId === 'a')).toHaveLength(1);
    expect(merged.find((u) => u.sessionId === 'a')!.estimated).toBe(false);
  });
});
