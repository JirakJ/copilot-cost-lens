import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { estimateTokensFromChars, totalTextLength } from '../core/estimate';
import { readJsonlRecords } from './jsonl';
import { RawUsage } from '../types';

/**
 * Reads usage from GitHub Copilot CLI session event logs:
 *   ~/.copilot/session-state/<sessionId>.jsonl          (older layout)
 *   ~/.copilot/session-state/<sessionId>/events.jsonl   (newer layout)
 *
 * `session.shutdown` events carry exact per-model metrics for the finished
 * run (tokens incl. cache read/write, billed premium requests, nano AI-credit
 * units). Metrics are per-run, so multiple shutdowns in a resumed session are
 * summed. Sessions that never reached a shutdown fall back to per-message
 * estimation (exact output tokens, estimated input from content).
 */
export function defaultCopilotCliRoot(): string {
  return path.join(os.homedir(), '.copilot', 'session-state');
}

export interface CopilotCliFile {
  filePath: string;
  sessionId: string;
}

export async function findCopilotCliFiles(root: string): Promise<CopilotCliFile[]> {
  const files: CopilotCliFile[] = [];
  for (const entry of await safeReaddir(root)) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push({ filePath: full, sessionId: entry.name.replace(/\.jsonl$/, '') });
    } else if (entry.isDirectory()) {
      const eventsPath = path.join(full, 'events.jsonl');
      try {
        await fs.access(eventsPath);
        files.push({ filePath: eventsPath, sessionId: entry.name });
      } catch {
        // directory without events.jsonl — skip
      }
    }
  }
  return files;
}

export interface CopilotCliOptions {
  charsPerToken: number;
}

export async function parseCopilotCliUsage(
  file: CopilotCliFile,
  options: CopilotCliOptions,
): Promise<RawUsage[]> {
  const shutdownUsages: RawUsage[] = [];

  let cwd: string | undefined;
  let repoSlug: string | undefined;
  let lastTimestamp = 0;
  let currentModel = 'unknown';

  // fallback accumulators (used only when no shutdown event exists)
  const fallbackByModel = new Map<string, { inputChars: number; outputTokens: number }>();

  await readJsonlRecords(file.filePath, (record) => {
    const type = typeof record.type === 'string' ? record.type : '';
    const data = asRecord(record.data);
    const ts = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      lastTimestamp = Math.max(lastTimestamp, ts);
    }

    switch (type) {
      case 'session.start': {
        const context = asRecord(data.context);
        cwd ??= str(context.cwd);
        const repository = str(context.repository);
        if (repository && repository.includes('/')) {
          repoSlug ??= repository;
        }
        break;
      }
      case 'session.model_change': {
        currentModel = str(data.model) ?? str(data.newModel) ?? currentModel;
        break;
      }
      case 'user.message': {
        const entry = fallbackEntry(fallbackByModel, currentModel);
        entry.inputChars += totalTextLength(data.content);
        break;
      }
      case 'tool.execution_complete': {
        // tool results are fed back into the model as input
        const entry = fallbackEntry(fallbackByModel, str(data.model) ?? currentModel);
        entry.inputChars += totalTextLength(data.result);
        break;
      }
      case 'assistant.message': {
        const model = str(data.model) ?? currentModel;
        currentModel = model;
        const entry = fallbackEntry(fallbackByModel, model);
        const exactOut = num(data.outputTokens);
        entry.outputTokens +=
          exactOut > 0
            ? exactOut
            : estimateTokensFromChars(
                totalTextLength(data.content) + totalTextLength(data.toolRequests),
                options.charsPerToken,
              );
        break;
      }
      case 'session.shutdown': {
        const metrics = asRecord(data.modelMetrics);
        for (const [model, value] of Object.entries(metrics)) {
          const usage = asRecord(asRecord(value).usage);
          const requests = asRecord(asRecord(value).requests);
          shutdownUsages.push({
            sessionId: file.sessionId,
            provider: 'copilot-cli',
            folderPath: cwd,
            repoSlug,
            timestamp: Number.isNaN(ts) ? lastTimestamp || Date.now() : ts,
            model,
            inputTokens: num(usage.inputTokens),
            outputTokens: num(usage.outputTokens),
            cachedTokens: num(usage.cacheReadTokens),
            cacheWriteTokens: num(usage.cacheWriteTokens),
            nanoCredits: positiveOrUndefined(num(asRecord(value).totalNanoAiu)),
            premiumRequests: positiveOrUndefined(num(requests.cost)),
            estimated: false,
          });
        }
        // a shutdown closes the current run; reset the fallback accumulators
        fallbackByModel.clear();
        break;
      }
    }
  });

  if (shutdownUsages.length > 0) {
    return shutdownUsages;
  }

  // No shutdown (crashed or still-running session) — estimate per model.
  const estimated: RawUsage[] = [];
  for (const [model, entry] of fallbackByModel) {
    if (entry.inputChars === 0 && entry.outputTokens === 0) {
      continue;
    }
    estimated.push({
      sessionId: file.sessionId,
      provider: 'copilot-cli',
      folderPath: cwd,
      repoSlug,
      timestamp: lastTimestamp || Date.now(),
      model,
      inputTokens: estimateTokensFromChars(entry.inputChars, options.charsPerToken),
      outputTokens: entry.outputTokens,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      estimated: true,
    });
  }
  return estimated;
}

function fallbackEntry(
  map: Map<string, { inputChars: number; outputTokens: number }>,
  model: string,
): { inputChars: number; outputTokens: number } {
  const existing = map.get(model);
  if (existing) {
    return existing;
  }
  const created = { inputChars: 0, outputTokens: 0 };
  map.set(model, created);
  return created;
}

async function safeReaddir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
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

function positiveOrUndefined(value: number): number | undefined {
  return value > 0 ? value : undefined;
}
