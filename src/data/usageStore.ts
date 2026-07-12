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
  mtimeMs: number;
  size: number;
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
    if (!this.scanning) {
      this.scanning = this.scan().finally(() => {
        this.scanning = undefined;
      });
    }
    return this.scanning;
  }

  private async scan(): Promise<UsageEvent[]> {
    const started = Date.now();
    const exact: RawUsage[] = [];
    const estimated: RawUsage[] = [];
    const errors: string[] = [];
    const scannedRoots: string[] = [];
    let filesParsed = 0;
    const push = (usages: RawUsage[]) => {
      filesParsed += 1;
      for (const usage of usages) {
        (usage.estimated ? estimated : exact).push(usage);
      }
    };
    // publish what we have after each source so the dashboard paints the first
    // results immediately instead of waiting for the whole (slow) scan
    const publish = async () => {
      this.events = await this.toEvents(dedupeBySession(exact, estimated));
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
      const roots = await detectStorageRoots(this.config.extraStorageRoots);
      scannedRoots.push(...roots);
      for (const root of roots) {
        for (const wsDir of await listWorkspaceStorageDirs(root)) {
          for (const file of await findJsonlFiles(wsDir)) {
            push(await this.parseCached(file.filePath, () => parseJsonlUsage(file, wsDir)));
          }
          if (this.config.estimationEnabled) {
            for (const sessionFile of await findChatSessionFiles(wsDir)) {
              push(
                await this.parseCached(sessionFile, () =>
                  parseChatSessionUsage(sessionFile, wsDir, {
                    charsPerToken: this.config.charsPerToken,
                  }),
                ),
              );
            }
          }
        }
      }
    });

    if (this.config.claudeCodeEnabled) {
      await guard('claude-code', async () => {
        scannedRoots.push(defaultClaudeCodeRoot());
        for (const file of await findClaudeCodeFiles(defaultClaudeCodeRoot())) {
          push(await this.parseCached(file, () => parseClaudeCodeUsage(file)));
        }
      });
    }

    if (this.config.copilotCliEnabled) {
      await guard('copilot-cli', async () => {
        scannedRoots.push(defaultCopilotCliRoot());
        for (const file of await findCopilotCliFiles(defaultCopilotCliRoot())) {
          push(
            await this.parseCached(file.filePath, () =>
              parseCopilotCliUsage(file, { charsPerToken: this.config.charsPerToken }),
            ),
          );
        }
      });
    }

    if (this.config.codexEnabled) {
      await guard('codex', async () => {
        scannedRoots.push(defaultCodexRoot());
        for (const file of await findCodexFiles(defaultCodexRoot())) {
          push(await this.parseCached(file, () => parseCodexUsage(file)));
        }
      });
    }

    if (this.config.jetbrainsCopilotEnabled) {
      await guard('copilot-jetbrains', async () => {
        scannedRoots.push(defaultJetBrainsCopilotRoot());
        for (const db of await findJetBrainsCopilotDbs(defaultJetBrainsCopilotRoot())) {
          push(await this.parseCached(db, () => parseJetBrainsUsage(db, { charsPerToken: this.config.charsPerToken })));
        }
      });
    }

    await publish(); // one final publish (the only one on non-first scans)
    this.firstScanDone = true;
    return this.events;
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

    const cached = this.fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.usages;
    }

    const usages = await parse();
    this.fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, usages });
    return usages;
  }

  private async toEvents(raw: RawUsage[]): Promise<UsageEvent[]> {
    const events: UsageEvent[] = [];
    for (const usage of raw) {
      const { credits, costSource } = priceUsage(usage, this.config.pricing);
      events.push({
        sessionId: usage.sessionId,
        provider: usage.provider,
        repo: await this.resolveRepo(usage),
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

  private async resolveRepo(usage: RawUsage): Promise<RepoRef> {
    const base = await this.baseRepo(usage);
    const alias = this.config.repoAliases[base.name];
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
  const exactSessions = new Set(exact.map((u) => u.sessionId));
  const kept = estimated.filter((u) => !exactSessions.has(u.sessionId));
  return [...exact, ...kept];
}
