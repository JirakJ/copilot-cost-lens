import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
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
  const base = path.join(workspaceStorageDir, 'GitHub.copilot-chat');
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
  workspaceStorageDir: string,
): Promise<RawUsage[]> {
  const usages: RawUsage[] = [];

  await forEachJsonLine(file.filePath, (record) => {
    const attrs = isRecord(record.attrs) ? record.attrs : {};
    const fields: Record<string, unknown> = { ...attrs, ...record };

    const model = firstString(fields, ['model', 'usage_model', 'modelName', 'model_name']);
    const inputTokens = firstNumber(fields, ['inputTokens', 'input_tokens', 'usage_input_tokens', 'promptTokens', 'prompt_tokens']);
    const outputTokens = firstNumber(fields, ['outputTokens', 'output_tokens', 'usage_output_tokens', 'completionTokens', 'completion_tokens']);
    const cachedTokens = firstNumber(fields, ['cachedTokens', 'cached_tokens', 'usage_cached_tokens']);
    const nanoCredits = firstNumber(fields, ['copilotUsageNanoAiu', 'copilot_usage_nano_aiu']);

    const hasUsage =
      nanoCredits !== undefined || inputTokens !== undefined || outputTokens !== undefined;
    if (!hasUsage) {
      return;
    }

    usages.push({
      sessionId: file.sessionId,
      workspaceStorageDir,
      timestamp: readTimestamp(fields) ?? Date.now(),
      model: model ?? 'unknown',
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cachedTokens: cachedTokens ?? 0,
      nanoCredits,
      estimated: false,
    });
  });

  return usages;
}

async function forEachJsonLine(
  filePath: string,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<void> {
  let stream;
  try {
    await fs.access(filePath);
    stream = createReadStream(filePath, { encoding: 'utf8' });
  } catch {
    return;
  }

  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (isRecord(parsed)) {
          onRecord(parsed);
        }
      } catch {
        // tolerate malformed lines — never let one record break the scan
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
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
