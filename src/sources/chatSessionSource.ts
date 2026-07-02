import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokensFromChars, totalTextLength } from '../core/estimate';
import { RawUsage } from '../types';

/**
 * Reads VS Code's own chat session store:
 *   <workspaceStorage>/<id>/chatSessions/<sessionId>.json    (legacy flat JSON)
 *   <workspaceStorage>/<id>/chatSessions/<sessionId>.jsonl   (log store, VS Code ≥1.128)
 *
 * The `.jsonl` format is an append-only mutation log (see upstream
 * chatSessionStore.ts / objectMutationLog.ts): line 1 is the full initial
 * state, later lines patch it (set / array-push / delete). Replaying the log
 * yields the final session object, which inherently dedupes repeated updates
 * to the same request. When both `.json` and `.jsonl` exist for one session
 * id, only the `.jsonl` is read.
 *
 * Log-store requests may carry exact usage (`promptTokens`,
 * `completionTokens`, `copilotCredits`); those are used directly, other
 * requests fall back to content-length estimation. All records stay marked
 * `estimated` so exact data from GitHub.copilot-chat logs for the same
 * session still supersedes them instead of double counting.
 */
export async function findChatSessionFiles(workspaceStorageDir: string): Promise<string[]> {
  const dir = path.join(workspaceStorageDir, 'chatSessions');
  try {
    const entries = await fs.readdir(dir);
    const logSessions = new Set(
      entries.filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -'.jsonl'.length)),
    );
    return entries
      .filter(
        (name) =>
          name.endsWith('.jsonl') ||
          (name.endsWith('.json') && !logSessions.has(name.slice(0, -'.json'.length))),
      )
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export interface ChatSessionOptions {
  charsPerToken: number;
}

export async function parseChatSessionUsage(
  filePath: string,
  workspaceStorageDir: string,
  options: ChatSessionOptions,
): Promise<RawUsage[]> {
  const usages = await parseOneFormat(filePath, workspaceStorageDir, options);
  if (usages.length > 0 || !filePath.endsWith('.jsonl')) {
    return usages;
  }
  // Empty/corrupt/stale .jsonl (crash-truncated migration, downgrade,
  // useLogSessionStorage turned off) — fall back to the sibling flat .json
  // it shadowed in findChatSessionFiles. No double-count risk: the .jsonl
  // contributed zero records.
  return parseOneFormat(filePath.replace(/\.jsonl$/, '.json'), workspaceStorageDir, options);
}

async function parseOneFormat(
  filePath: string,
  workspaceStorageDir: string,
  options: ChatSessionOptions,
): Promise<RawUsage[]> {
  let session: ChatSessionFile | undefined;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    session = filePath.endsWith('.jsonl')
      ? replaySessionLog(content)
      : (JSON.parse(content) as ChatSessionFile);
  } catch {
    return [];
  }
  if (!session || !Array.isArray(session.requests)) {
    return [];
  }

  const sessionId =
    typeof session.sessionId === 'string' && session.sessionId
      ? session.sessionId
      : path.basename(filePath).replace(/\.jsonl?$/, '');
  const fallbackTs = session.lastMessageDate ?? session.creationDate ?? Date.now();
  const usages: RawUsage[] = [];

  for (const request of session.requests) {
    if (!request || typeof request !== 'object') {
      continue;
    }
    const model = typeof request.modelId === 'string' && request.modelId ? request.modelId : 'unknown';
    const timestamp = typeof request.timestamp === 'number' ? request.timestamp : fallbackTs;

    // Log-store sessions carry exact per-request usage — prefer it.
    const exactInput = finiteNumber(request.promptTokens);
    const exactOutput = finiteNumber(request.completionTokens);
    const credits = finiteNumber(request.copilotCredits);
    if ((exactInput ?? 0) > 0 || (exactOutput ?? 0) > 0 || (credits ?? 0) > 0) {
      usages.push({
        sessionId,
        provider: 'copilot',
        workspaceStorageDir,
        timestamp,
        model,
        inputTokens: exactInput ?? 0,
        outputTokens: exactOutput ?? 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        nanoCredits: credits !== undefined && credits > 0 ? Math.round(credits * 1_000_000_000) : undefined,
        estimated: true,
      });
      continue;
    }

    // Input ≈ the user message; the response array plus tool-call rounds
    // approximate model output across the agentic loop.
    const promptChars = totalTextLength(request.message);
    const responseChars = totalTextLength(request.response) + totalTextLength(resultMetadata(request));
    if (promptChars === 0 && responseChars === 0) {
      continue;
    }

    usages.push({
      sessionId,
      provider: 'copilot',
      workspaceStorageDir,
      timestamp,
      model,
      inputTokens: estimateTokensFromChars(promptChars, options.charsPerToken),
      outputTokens: estimateTokensFromChars(responseChars, options.charsPerToken),
      cachedTokens: 0,
      cacheWriteTokens: 0,
      estimated: true,
    });
  }

  return usages;
}

/**
 * Replays a chat session mutation log into its final state. Line format
 * (upstream objectMutationLog.ts): {kind:0,v} initial, {kind:1,k,v} set,
 * {kind:2,k,v?,i?} array push (truncate to `i` first), {kind:3,k} delete.
 * Malformed lines and failed operations are skipped.
 */
function replaySessionLog(content: string): ChatSessionFile | undefined {
  let state: unknown;
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let entry: LogEntry;
    try {
      entry = JSON.parse(line) as LogEntry;
    } catch {
      continue;
    }
    try {
      switch (entry.kind) {
        case 0:
          state = entry.v;
          break;
        case 1:
          applySet(state, entry.k, entry.v);
          break;
        case 2:
          applyPush(state, entry.k, entry.v, entry.i);
          break;
        case 3:
          applySet(state, entry.k, undefined);
          break;
      }
    } catch {
      // corrupt operation — skip; usage extraction below is field-tolerant
    }
  }
  return isRecord(state) ? (state as ChatSessionFile) : undefined;
}

interface LogEntry {
  kind: number;
  k?: (string | number)[];
  v?: unknown;
  i?: number;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function walkToParent(state: unknown, keys: (string | number)[]): Record<string | number, unknown> | undefined {
  if (keys.some((key) => typeof key === 'string' && UNSAFE_KEYS.has(key))) {
    return undefined;
  }
  let current = state as Record<string | number, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]!] as Record<string | number, unknown>;
  }
  return isRecord(current) || Array.isArray(current) ? current : undefined;
}

function applySet(state: unknown, keys: (string | number)[] | undefined, value: unknown): void {
  if (!keys || keys.length === 0) {
    return;
  }
  const parent = walkToParent(state, keys);
  const key = keys[keys.length - 1]!;
  // arrays only ever take numeric indices — a string key (e.g. "length" from
  // a corrupt line) could blow the array up to millions of holes
  if (parent && (!Array.isArray(parent) || typeof key === 'number')) {
    parent[key] = value;
  }
}

function applyPush(state: unknown, keys: (string | number)[] | undefined, values: unknown, startIndex: number | undefined): void {
  if (!keys || keys.length === 0) {
    return;
  }
  const parent = walkToParent(state, keys);
  if (!parent) {
    return;
  }
  const arrayKey = keys[keys.length - 1]!;
  const arr = Array.isArray(parent[arrayKey]) ? (parent[arrayKey] as unknown[]) : [];
  // upstream only ever writes i <= arr.length (truncation) — a larger index
  // from a corrupt line would create a huge sparse array, so clamp
  if (typeof startIndex === 'number' && startIndex >= 0 && startIndex < arr.length) {
    arr.length = startIndex;
  }
  if (Array.isArray(values) && values.length > 0) {
    arr.push(...values);
  }
  parent[arrayKey] = arr;
}

function resultMetadata(request: ChatRequest): unknown {
  const result = request.result;
  if (result && typeof result === 'object') {
    return (result as Record<string, unknown>).metadata;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ChatSessionFile {
  sessionId?: string;
  creationDate?: number;
  lastMessageDate?: number;
  requests?: ChatRequest[];
}

interface ChatRequest {
  modelId?: string;
  timestamp?: number;
  message?: unknown;
  response?: unknown;
  result?: unknown;
  /** Exact usage written by the log store (VS Code ≥1.128). */
  promptTokens?: unknown;
  completionTokens?: unknown;
  copilotCredits?: unknown;
}
