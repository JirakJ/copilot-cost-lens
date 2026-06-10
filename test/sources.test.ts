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
    expect(usage.inputTokens).toBe(12000);
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
  it('estimates tokens from content length', async () => {
    const files = await findChatSessionFiles(wsDir);
    expect(files).toHaveLength(2);
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
