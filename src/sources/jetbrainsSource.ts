import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { estimateTokensFromChars } from '../core/estimate';
import { RawUsage } from '../types';

/**
 * Best-effort, **estimated** extraction of GitHub Copilot usage from the
 * JetBrains plugin's local session store:
 *   ~/.config/github-copilot/<ide>/{chat-agent-sessions,chat-sessions}/<id>/...nitrite.db
 *
 * The JetBrains plugin does NOT persist token counts or AI-credit usage
 * (unlike the Copilot CLI and Claude Code). This source reads the readable
 * UTF-8 runs out of the Nitrite/MVStore files to recover the project path and
 * the models used, then estimates token volume from the readable text length.
 * Every event is marked estimated. Reads are capped and scaled so large DBs
 * stay cheap; the format is undocumented, so failures degrade to nothing.
 */
const SAMPLE_CAP_BYTES = 4 * 1024 * 1024;
const MIN_RUN = 6;
const IDE_DIRS = ['iu', 'ic', 'intellij', 'py', 'pc', 'ps', 'go', 'rd', 'ws', 'rm', 'cl', 'ja'];

// Bounded to known model families with fixed suffix vocabularies, so a stray
// serialization byte after the id ("gemini-2.5-prot") is not absorbed and
// binary noise like "o3" is not mistaken for a model.
const MODEL_RE =
  /claude-(?:opus|sonnet|haiku|fable)-\d+(?:\.\d+)?|gpt-\d+(?:\.\d+)?(?:-(?:codex-max|codex|mini|nano))?|gemini-\d+(?:\.\d+)?-(?:pro|flash)|grok-code-fast-1|raptor-mini|mai-code-1-flash/g;
// any reasonably deep absolute unix path; resolveRepoRoot validates against FS
const PATH_RE = /\/[\w.-]+(?:\/[\w.-]+){2,30}/g;

export function defaultJetBrainsCopilotRoot(): string {
  return path.join(os.homedir(), '.config', 'github-copilot');
}

export async function findJetBrainsCopilotDbs(root: string): Promise<string[]> {
  const dbs: string[] = [];
  for (const ide of IDE_DIRS) {
    for (const kind of ['chat-agent-sessions', 'chat-sessions']) {
      const base = path.join(root, ide, kind);
      for (const sessionDir of await safeReaddir(base)) {
        const dir = path.join(base, sessionDir);
        for (const name of await safeReaddir(dir)) {
          if (name.endsWith('nitrite.db')) {
            dbs.push(path.join(dir, name));
          }
        }
      }
    }
  }
  return dbs;
}

export interface JetBrainsOptions {
  charsPerToken: number;
}

export async function parseJetBrainsUsage(
  dbPath: string,
  options: JetBrainsOptions,
): Promise<RawUsage[]> {
  const sample = await readPrintable(dbPath);
  if (!sample) {
    return [];
  }

  const models = sample.text.match(MODEL_RE) ?? [];
  if (models.length === 0) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const m of models) {
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }

  const folderPath = await mostFrequentRepoRoot(sample.text);
  const stat = await fs.stat(dbPath).catch(() => undefined);
  const timestamp = stat?.mtimeMs ?? Date.now();
  const totalTokens = estimateTokensFromChars(sample.text.length, options.charsPerToken) * sample.scale;
  const totalCount = [...counts.values()].reduce((a, b) => a + b, 0);
  const sessionId = `jb-${path.basename(path.dirname(dbPath))}`;

  return [...counts.entries()].map(([model, count]) => {
    const tokens = Math.round(totalTokens * (count / totalCount));
    return {
      sessionId,
      provider: 'copilot' as const,
      folderPath,
      timestamp,
      model,
      inputTokens: Math.round(tokens * 0.85),
      outputTokens: Math.round(tokens * 0.15),
      cachedTokens: 0,
      cacheWriteTokens: 0,
      estimated: true,
    };
  });
}

interface Sample {
  text: string;
  scale: number;
}

/** Joined runs of printable text from a capped prefix of the file, plus a scale factor. */
async function readPrintable(filePath: string): Promise<Sample | undefined> {
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat || stat.size === 0) {
    return undefined;
  }
  const cap = Math.min(stat.size, SAMPLE_CAP_BYTES);
  const chunks: Buffer[] = [];
  let read = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { start: 0, end: cap - 1 });
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
      chunks.push(buf);
      read += buf.length;
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buffer = Buffer.concat(chunks, read);

  const parts: string[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart >= 0 && end - runStart >= MIN_RUN) {
      parts.push(buffer.toString('latin1', runStart, end));
    }
    runStart = -1;
  };
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      if (runStart < 0) {
        runStart = i;
      }
    } else {
      flush(i);
    }
  }
  flush(buffer.length);
  if (parts.length === 0) {
    return undefined;
  }
  const scale = stat.size > cap ? Math.max(1, Math.ceil(stat.size / cap)) : 1;
  return { text: parts.join(' '), scale };
}

async function mostFrequentRepoRoot(text: string): Promise<string | undefined> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const match of text.match(PATH_RE) ?? []) {
    if (seen.has(match)) {
      continue;
    }
    seen.add(match);
    const root = await resolveRepoRoot(match);
    if (root) {
      counts.set(root, (counts.get(root) ?? 0) + 1);
    }
  }
  // re-count by total occurrences (not just distinct) for a stable winner
  let best: string | undefined;
  let bestScore = 0;
  for (const [root] of counts) {
    const score = occurrences(text, root);
    if (score > bestScore) {
      bestScore = score;
      best = root;
    }
  }
  return best;
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function resolveRepoRoot(candidate: string): Promise<string | undefined> {
  let dir = (await isDirectory(candidate)) ? candidate : path.dirname(candidate);
  for (let depth = 0; depth < 12 && dir && dir !== path.dirname(dir); depth++) {
    if (await exists(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  if (await isDirectory(candidate)) {
    return candidate;
  }
  const parent = path.dirname(candidate);
  return (await isDirectory(parent)) ? parent : undefined;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
