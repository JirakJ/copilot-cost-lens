import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { estimateTokensFromChars, totalTextLength } from '../core/estimate';
import { RawUsage } from '../types';

/**
 * Reads VS Code's own chat session store:
 *   <workspaceStorage>/<id>/chatSessions/<sessionId>.json
 *
 * These files exist for every Copilot Chat conversation but carry no token
 * counts, so usage is *estimated* from content length. Estimated records are
 * marked and are superseded by exact JSONL data for the same session id.
 */
export async function findChatSessionFiles(workspaceStorageDir: string): Promise<string[]> {
  const dir = path.join(workspaceStorageDir, 'chatSessions');
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name));
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
  let session: ChatSessionFile;
  try {
    session = JSON.parse(await fs.readFile(filePath, 'utf8')) as ChatSessionFile;
  } catch {
    return [];
  }
  if (!Array.isArray(session.requests)) {
    return [];
  }

  const sessionId = session.sessionId ?? path.basename(filePath, '.json');
  const fallbackTs = session.lastMessageDate ?? session.creationDate ?? Date.now();
  const usages: RawUsage[] = [];

  for (const request of session.requests) {
    if (!request || typeof request !== 'object') {
      continue;
    }
    const model = typeof request.modelId === 'string' && request.modelId ? request.modelId : 'unknown';
    const timestamp = typeof request.timestamp === 'number' ? request.timestamp : fallbackTs;

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

function resultMetadata(request: ChatRequest): unknown {
  const result = request.result;
  if (result && typeof result === 'object') {
    return (result as Record<string, unknown>).metadata;
  }
  return undefined;
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
}
