import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { readJsonlRecords } from './jsonl';
import { RawUsage } from '../types';

/**
 * Reads exact usage from the Copilot Chat extension's local logs:
 *   <workspaceStorage>/<id>/GitHub.copilot-chat/transcripts/<sessionId>.jsonl
 *   <workspaceStorage>/<id>/GitHub.copilot-chat/debug-logs/<sessionId>/*.jsonl
 *
 * Records of interest carry per-request token counts and, when present,
 * `copilotUsageNanoAiu` — billed AI-credit nano units (1e9 = 1 credit).
 * The format is not a stable API, so parsing is field-tolerant: unknown
 * or malformed lines are skipped.
 */
export async function findJsonlFiles(workspaceStorageDir: string): Promise<JsonlFile[]> {
  return findCopilotChatLogs(path.join(workspaceStorageDir, 'GitHub.copilot-chat'));
}

/**
 * Copilot Chat >= 0.71 writes its debug logs to the extension's *global*
 * storage instead of the per-workspace one:
 *   <User>/globalStorage/github.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *   <User>/globalStorage/github.copilot-chat/debug-logs/<sessionId>/<label>-<childId>.jsonl
 * The record format is unchanged (`llm_request` with `attrs.inputTokens`),
 * but the files no longer sit next to `workspace.json`, so the caller
 * attributes them to a workspace by session id (see `indexChatSessionIds`).
 */
export async function findGlobalJsonlFiles(globalStorageDir: string): Promise<JsonlFile[]> {
  return findCopilotChatLogs(globalStorageDir);
}

/**
 * Map chat session id -> workspaceStorage dir, from the session files VS Code
 * keeps per workspace (`chatSessions/<id>.json[l]`, `chatEditingSessions/<id>`).
 * The first workspace that claims an id wins.
 */
export async function indexChatSessionIds(
  workspaceStorageDir: string,
  into: Map<string, string>,
): Promise<void> {
  for (const sub of ['chatSessions', 'chatEditingSessions']) {
    for (const name of await safeReaddir(path.join(workspaceStorageDir, sub))) {
      const id = name.replace(/\.jsonl?$/, '');
      if (id && !into.has(id)) {
        into.set(id, workspaceStorageDir);
      }
    }
  }
}

async function findCopilotChatLogs(base: string): Promise<JsonlFile[]> {
  const files: JsonlFile[] = [];

  const transcriptsDir = path.join(base, 'transcripts');
  for (const name of await safeReaddir(transcriptsDir)) {
    if (name.endsWith('.jsonl')) {
      files.push({
        filePath: path.join(transcriptsDir, name),
        sessionId: name.replace(/\.jsonl$/, ''),
      });
    }
  }

  const debugLogsDir = path.join(base, 'debug-logs');
  for (const sessionDir of await safeReaddir(debugLogsDir)) {
    const dir = path.join(debugLogsDir, sessionDir);
    for (const name of await safeReaddir(dir)) {
      if (name.endsWith('.jsonl')) {
        files.push({ filePath: path.join(dir, name), sessionId: sessionDir });
      }
    }
  }

  return files;
}

export interface JsonlFile {
  filePath: string;
  sessionId: string;
}

export async function parseJsonlUsage(
  file: JsonlFile,
  workspaceStorageDir: string | undefined,
): Promise<RawUsage[]> {
  const usages: RawUsage[] = [];

  await readJsonlRecords(file.filePath, (record) => {
    const attrs = isRecord(record.attrs) ? record.attrs : {};
    const fields: Record<string, unknown> = { ...attrs, ...record };

    const model = firstString(fields, ['model', 'usage_model', 'modelName', 'model_name']);
    const inputTokens = firstNumber(fields, ['inputTokens', 'input_tokens', 'usage_input_tokens', 'promptTokens', 'prompt_tokens']);
    const outputTokens = firstNumber(fields, ['outputTokens', 'output_tokens', 'usage_output_tokens', 'completionTokens', 'completion_tokens']);
    const cachedTokens = firstNumber(fields, ['cachedTokens', 'cached_tokens', 'usage_cached_tokens']);
    const cacheWriteTokens = firstNumber(fields, ['cacheWriteTokens', 'cache_write_tokens', 'cacheCreationTokens']);
    const nanoCredits = firstNumber(fields, ['copilotUsageNanoAiu', 'copilot_usage_nano_aiu']);

    const hasUsage =
      nanoCredits !== undefined || inputTokens !== undefined || outputTokens !== undefined;
    if (!hasUsage) {
      return;
    }

    // OpenAI-style usage reports prompt/input tokens inclusive of cached;
    // normalize to the disjoint convention (fresh input only).
    const cached = cachedTokens ?? 0;
    const freshInput = Math.max(0, (inputTokens ?? 0) - cached);

    usages.push({
      sessionId: file.sessionId,
      provider: 'copilot',
      workspaceStorageDir,
      timestamp: readTimestamp(fields) ?? Date.now(),
      model: model ?? 'unknown',
      inputTokens: freshInput,
      outputTokens: outputTokens ?? 0,
      cachedTokens: cached,
      cacheWriteTokens: cacheWriteTokens ?? 0,
      nanoCredits,
      estimated: false,
    });
  });

  return usages;
}

function readTimestamp(fields: Record<string, unknown>): number | undefined {
  const numeric = firstNumber(fields, ['ts', 'timestamp', 'time']);
  if (numeric !== undefined) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const text = firstString(fields, ['timestamp', 'time', 'createdAt', 'created_at', 'date']);
  if (text) {
    const ms = Date.parse(text);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }
  return undefined;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(fields: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstNumber(fields: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
