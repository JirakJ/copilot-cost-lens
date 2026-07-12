import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RawUsage } from '../types';
import { readJsonlRecords } from './jsonl';

/** Reads exact token usage from ChatGPT Codex CLI/Desktop rollout logs. */
export function defaultCodexRoot(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export async function findCodexFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walk(root, files);
  return files;
}

export async function parseCodexUsage(filePath: string): Promise<RawUsage[]> {
  const usages: RawUsage[] = [];
  const fallbackSessionId = path.basename(filePath, '.jsonl');
  let sessionId = fallbackSessionId;
  let folderPath: string | undefined;
  let model = 'unknown';

  await readJsonlRecords(filePath, (record) => {
    const payload = asRecord(record.payload);
    if (record.type === 'session_meta') {
      sessionId = str(payload.session_id) ?? str(payload.id) ?? sessionId;
      folderPath = str(payload.cwd) ?? folderPath;
      return;
    }
    if (record.type === 'turn_context') {
      model = str(payload.model) ?? model;
      folderPath = str(payload.cwd) ?? folderPath;
      return;
    }
    if (record.type !== 'event_msg' || payload.type !== 'token_count') {
      return;
    }

    const info = asRecord(payload.info);
    const last = asRecord(info.last_token_usage);
    const input = num(last.input_tokens);
    const cached = Math.min(input, num(last.cached_input_tokens));
    const output = num(last.output_tokens);
    if (input === 0 && output === 0) {
      return;
    }
    const timestamp = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    usages.push({
      sessionId,
      provider: 'codex',
      folderPath,
      timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
      model,
      inputTokens: input - cached,
      outputTokens: output,
      cachedTokens: cached,
      cacheWriteTokens: 0,
      estimated: false,
    });
  });

  return usages;
}

async function walk(dir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(full);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}
