import * as fs from 'node:fs/promises';
import { normalizeModelId, priceUsage, PricingOptions } from '../core/pricing';
import { findChatSessionFiles, parseChatSessionUsage } from '../sources/chatSessionSource';
import { defaultClaudeCodeRoot, findClaudeCodeFiles, parseClaudeCodeUsage } from '../sources/claudeCodeSource';
import { defaultCopilotCliRoot, findCopilotCliFiles, parseCopilotCliUsage } from '../sources/copilotCliSource';
import { defaultCodexRoot, findCodexFiles, parseCodexUsage } from '../sources/codexSource';
import { defaultJetBrainsCopilotRoot, findJetBrainsCopilotDbs, parseJetBrainsUsage } from '../sources/jetbrainsSource';
import { findJsonlFiles, parseJsonlUsage } from '../sources/jsonlSource';
import { detectStorageRoots, listWorkspaceStorageDirs } from '../sources/storageRoots';
import { WorkspaceIndex } from '../sources/workspaceIndex';
import { RawUsage, RepoRef, UsageEvent } from '../types';

export interface StoreConfig {
  extraStorageRoots: string[];
  /** Map of resolved repo name → user-chosen display name. */
  repoAliases: Record<string, string>;
  claudeCodeEnabled: boolean;
  copilotCliEnabled: boolean;
  codexEnabled: boolean;
  jetbrainsCopilotEnabled: boolean;
  estimationEnabled: boolean;
  charsPerToken: number;
  pricing: PricingOptions;
}

/** Diagnostics for the last scan — surfaced in the dashboard and output channel. */
export interface ScanStats {
  /** Total events per provider (all time, before month filtering). */
  providers: Record<string, number>;
  /** Timestamp of the newest event found, 0 when none. */
  newestTimestamp: number;
  scanMs: number;
  filesParsed: number;
  errors: string[];
  /** Storage roots that were scanned this run (for diagnostics). */
  scannedRoots: string[];
}

interface FileCacheEntry {
  fingerprint: string;
  usages: RawUsage[];
}

/**
 * Scans every detected data source — VS Code Copilot Chat logs, Claude Code,
 * ChatGPT Codex and Copilot CLI session events — then dedupes and prices the
 * result. Incremental: unchanged files are served from an mtime+size cache,
 * so periodic rescans stay cheap.
 */
export class UsageStore {
  private fileCache = new Map<string, FileCacheEntry>();
  private workspaceIndex = new WorkspaceIndex();
  private events: UsageEvent[] = [];
  private scanning?: Promise<UsageEvent[]>;
  private listeners = new Set<() => void>();
  private firstScanDone = false;
  private parsedCharsPerToken?: number;
  private disposed = false;
  private stats: ScanStats = {
    providers: {},
    newestTimestamp: 0,
    scanMs: 0,
    filesParsed: 0,
    errors: [],
    scannedRoots: [],
  };

  constructor(private config: StoreConfig) {}

  getStats(): ScanStats {
    return this.stats;
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateConfig(config: StoreConfig): void {
    this.config = config;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.fileCache.clear();
    this.events = [];
  }

  getEvents(): UsageEvent[] {
    return this.events;
  }

  /** Directories worth watching for new usage data. */
  async getWatchDirs(): Promise<string[]> {
    const dirs = await detectStorageRoots(this.config.extraStorageRoots);
    if (this.config.claudeCodeEnabled) {
      dirs.push(defaultClaudeCodeRoot());
    }
    if (this.config.copilotCliEnabled) {
      dirs.push(defaultCopilotCliRoot());
    }
    if (this.config.codexEnabled) {
      dirs.push(defaultCodexRoot());
    }
    if (this.config.jetbrainsCopilotEnabled) {
      dirs.push(defaultJetBrainsCopilotRoot());
    }
    return dirs;
  }

  async refresh(): Promise<UsageEvent[]> {
    if (this.disposed) {
      return this.events;
    }
    if (!this.scanning) {
      this.scanning = this.scanLatestConfig().finally(() => {
        this.scanning = undefined;
      });
    }
    return this.scanning;
  }

  private async scanLatestConfig(): Promise<UsageEvent[]> {
    let config: StoreConfig;
    do {
      config = this.config;
      await this.scan(config);
    } while (!this.disposed && config !== this.config);
    return this.events;
  }

  private async scan(config: StoreConfig): Promise<void> {
    if (this.parsedCharsPerToken !== config.charsPerToken) {
      this.fileCache.clear();
      this.parsedCharsPerToken = config.charsPerToken;
    }
    this.workspaceIndex = new WorkspaceIndex();
    const started = Date.now();
    const exact: RawUsage[] = [];
    const estimated: RawUsage[] = [];
    const errors: string[] = [];
    const scannedRoots: string[] = [];
    let filesParsed = 0;
    const seenFiles = new Set<string>();
    const read = async (file: string, parse: () => Promise<RawUsage[]>): Promise<RawUsage[]> => {
      if (this.disposed || seenFiles.has(file)) {
        return [];
      }
      seenFiles.add(file);
      try {
        return await this.parseCached(file, parse);
      } catch (error) {
        errors.push(`Could not read ${file} (${error instanceof Error ? error.name : 'Error'})`);
        return [];
      }
    };
    const push = (usages: RawUsage[]) => {
      filesParsed += 1;
      for (const usage of usages) {
        (usage.estimated ? estimated : exact).push(usage);
      }
    };
    // publish what we have after each source so the dashboard paints the first
    // results immediately instead of waiting for the whole (slow) scan
    const publish = async () => {
      const events = await this.toEvents(dedupeBySession(exact, estimated), config, errors);
      if (this.disposed || config !== this.config) {
        return;
      }
      this.events = events;
      const providers: Record<string, number> = {};
      let newestTimestamp = 0;
      for (const event of this.events) {
        providers[event.provider] = (providers[event.provider] ?? 0) + 1;
        newestTimestamp = Math.max(newestTimestamp, event.timestamp);
      }
      this.stats = { providers, newestTimestamp, scanMs: Date.now() - started, filesParsed, errors, scannedRoots };
      for (const listener of this.listeners) {
        listener();
      }
    };
    // paint progressively only on the very first scan (empty dashboard);
    // later refreshes publish once at the end so they don't flash partial data
    const progressive = !this.firstScanDone;
    const guard = async (source: string, work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (progressive) {
        await publish();
      }
    };

    await guard('vscode', async () => {
      const roots = await detectStorageRoots(config.extraStorageRoots);
      scannedRoots.push(...roots);
      for (const root of roots) {
        for (const wsDir of await listWorkspaceStorageDirs(root)) {
          for (const file of await findJsonlFiles(wsDir)) {
            push(await read(file.filePath, () => parseJsonlUsage(file, wsDir)));
          }
          if (config.estimationEnabled) {
            for (const sessionFile of await findChatSessionFiles(wsDir)) {
              push(
                await read(sessionFile, () =>
                  parseChatSessionUsage(sessionFile, wsDir, {
                    charsPerToken: config.charsPerToken,
                  }),
                ),
              );
            }
          }
        }
      }
    });

    if (config.claudeCodeEnabled) {
      await guard('claude-code', async () => {
        scannedRoots.push(defaultClaudeCodeRoot());
        for (const file of await findClaudeCodeFiles(defaultClaudeCodeRoot())) {
          push(await read(file, () => parseClaudeCodeUsage(file)));
        }
      });
    }

    if (config.copilotCliEnabled) {
      await guard('copilot-cli', async () => {
        scannedRoots.push(defaultCopilotCliRoot());
        for (const file of await findCopilotCliFiles(defaultCopilotCliRoot())) {
          push(
            await read(file.filePath, () =>
              parseCopilotCliUsage(file, { charsPerToken: config.charsPerToken }),
            ),
          );
        }
      });
    }

    if (config.codexEnabled) {
      await guard('codex', async () => {
        scannedRoots.push(defaultCodexRoot());
        for (const file of await findCodexFiles(defaultCodexRoot())) {
          push(await read(file, () => parseCodexUsage(file)));
        }
      });
    }

    if (config.jetbrainsCopilotEnabled) {
      await guard('copilot-jetbrains', async () => {
        scannedRoots.push(defaultJetBrainsCopilotRoot());
        for (const db of await findJetBrainsCopilotDbs(defaultJetBrainsCopilotRoot())) {
          push(await read(db, () => parseJetBrainsUsage(db, { charsPerToken: config.charsPerToken })));
        }
      });
    }

    await publish(); // one final publish (the only one on non-first scans)
    for (const file of this.fileCache.keys()) {
      if (this.disposed || !seenFiles.has(file)) {
        this.fileCache.delete(file);
      }
    }
    this.firstScanDone = true;
  }

  private async parseCached(
    filePath: string,
    parse: () => Promise<RawUsage[]>,
  ): Promise<RawUsage[]> {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      this.fileCache.delete(filePath);
      return [];
    }

    if (!stat.isFile()) {
      return [];
    }
    const fallback = filePath.endsWith('.jsonl') && filePath.includes('chatSessions')
      ? await fs.stat(filePath.replace(/\.jsonl$/, '.json')).catch(() => undefined)
      : undefined;
    const fingerprint = `${stat.mtimeMs}:${stat.size}:${fallback?.mtimeMs}:${fallback?.size}`;
    const cached = this.fileCache.get(filePath);
    if (cached && cached.fingerprint === fingerprint) {
      return cached.usages;
    }

    const usages = await parse();
    if (!this.disposed) {
      this.fileCache.set(filePath, { fingerprint, usages });
    }
    return usages;
  }

  private async toEvents(raw: RawUsage[], config: StoreConfig, errors: string[]): Promise<UsageEvent[]> {
    const events: UsageEvent[] = [];
    const invalid = () => {
      const message = 'Ignored usage records with invalid dates, token counts or costs.';
      if (!errors.includes(message)) errors.push(message);
    };
    for (const usage of raw) {
      if (this.disposed) {
        break;
      }
      // Log files are untrusted input. Invalid dates/counts must never poison
      // an entire report or crash Date.toISOString during an export.
      if (!Number.isFinite(usage.timestamp) || !Number.isFinite(new Date(usage.timestamp).getTime()) ||
          [usage.inputTokens, usage.outputTokens, usage.cachedTokens, usage.cacheWriteTokens]
            .some((n) => !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)) {
        invalid();
        continue;
      }
      const { credits, costSource } = priceUsage(usage, config.pricing);
      if (!Number.isFinite(credits) || credits < 0 || credits > Number.MAX_SAFE_INTEGER) {
        invalid();
        continue;
      }
      events.push({
        sessionId: usage.sessionId,
        provider: usage.provider,
        repo: await this.resolveRepo(usage, config),
        timestamp: usage.timestamp,
        model: normalizeModelId(usage.model),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        credits,
        costSource,
      });
    }
    events.sort((a, b) => a.timestamp - b.timestamp);
    return events;
  }

  private async resolveRepo(usage: RawUsage, config: StoreConfig): Promise<RepoRef> {
    const base = await this.baseRepo(usage);
    const alias = Object.hasOwn(config.repoAliases, base.name) ? config.repoAliases[base.name] : undefined;
    return alias ? { ...base, name: alias } : base;
  }

  private async baseRepo(usage: RawUsage): Promise<RepoRef> {
    if (usage.repoSlug) {
      return { name: usage.repoSlug, folderPath: usage.folderPath, remoteSlug: usage.repoSlug };
    }
    if (usage.folderPath) {
      return this.workspaceIndex.resolveFolder(usage.folderPath);
    }
    if (usage.workspaceStorageDir) {
      return this.workspaceIndex.resolve(usage.workspaceStorageDir);
    }
    return { name: '(unknown)' };
  }
}

/**
 * Exact data wins over estimates for the same session: a session that has
 * any exact usage drops all of its estimated records.
 */
export function dedupeBySession(exact: RawUsage[], estimated: RawUsage[]): RawUsage[] {
  const key = (u: RawUsage) => JSON.stringify([u.provider, u.workspaceStorageDir, u.sessionId]);
  const exactSessions = new Set(exact.map(key));
  const kept = estimated.filter((u) => !exactSessions.has(key(u)));
  return [...exact, ...kept];
}
