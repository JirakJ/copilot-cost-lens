import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJsonlRecords } from './jsonl';
import { RawUsage } from '../types';

/**
 * Reads exact usage from Claude Code session transcripts:
 *   ~/.claude/projects/<encoded-project-path>/<sessionId>.jsonl
 *
 * Assistant records carry the model and exact token usage including cache
 * reads and cache writes, plus the working directory for repo attribution.
 * Streaming can persist several records for one API message, so records are
 * deduplicated by message id + request id (last one wins).
 */
export function defaultClaudeCodeRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

export async function findClaudeCodeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const project of await safeReaddir(root)) {
    const dir = path.join(root, project);
    for (const name of await safeReaddir(dir)) {
      if (name.endsWith('.jsonl')) {
        files.push(path.join(dir, name));
      }
    }
  }
  return files;
}

export async function parseClaudeCodeUsage(filePath: string): Promise<RawUsage[]> {
  const byMessage = new Map<string, RawUsage>();
  const fallbackSessionId = path.basename(filePath, '.jsonl');

  await readJsonlRecords(filePath, (record) => {
    if (record.type !== 'assistant') {
      return;
    }
    const message = asRecord(record.message);
    const usage = asRecord(message.usage);
    if (Object.keys(usage).length === 0) {
      return;
    }

    const model = typeof message.model === 'string' ? message.model : 'unknown';
    if (model === '<synthetic>') {
      return; // synthetic system responses carry no real usage
    }

    const timestamp =
      typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    const dedupeKey = `${str(message.id) ?? ''}:${str(record.requestId) ?? byMessage.size}`;

    byMessage.set(dedupeKey, {
      sessionId: str(record.sessionId) ?? fallbackSessionId,
      provider: 'claude-code',
      folderPath: str(record.cwd),
      timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
      model,
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cachedTokens: num(usage.cache_read_input_tokens),
      cacheWriteTokens: num(usage.cache_creation_input_tokens),
      estimated: false,
    });
  });

  return [...byMessage.values()];
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
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
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
