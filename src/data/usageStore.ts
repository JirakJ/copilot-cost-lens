import * as fs from 'node:fs/promises';
import { normalizeModelId, priceUsage, PricingOptions } from '../core/pricing';
import { findChatSessionFiles, parseChatSessionUsage } from '../sources/chatSessionSource';
import { defaultClaudeCodeRoot, findClaudeCodeFiles, parseClaudeCodeUsage } from '../sources/claudeCodeSource';
import { defaultCopilotCliRoot, findCopilotCliFiles, parseCopilotCliUsage } from '../sources/copilotCliSource';
import { findJsonlFiles, parseJsonlUsage } from '../sources/jsonlSource';
import { detectStorageRoots, listWorkspaceStorageDirs } from '../sources/storageRoots';
import { WorkspaceIndex } from '../sources/workspaceIndex';
import { RawUsage, RepoRef, UsageEvent } from '../types';

export interface StoreConfig {
  extraStorageRoots: string[];
  claudeCodeEnabled: boolean;
  copilotCliEnabled: boolean;
  estimationEnabled: boolean;
  charsPerToken: number;
  pricing: PricingOptions;
}

interface FileCacheEntry {
  mtimeMs: number;
  size: number;
  usages: RawUsage[];
}

/**
 * Scans every detected data source — VS Code Copilot Chat logs, Claude Code
 * transcripts and Copilot CLI session events — then dedupes and prices the
 * result. Incremental: unchanged files are served from an mtime+size cache,
 * so periodic rescans stay cheap.
 */
export class UsageStore {
  private fileCache = new Map<string, FileCacheEntry>();
  private workspaceIndex = new WorkspaceIndex();
  private events: UsageEvent[] = [];
  private scanning?: Promise<UsageEvent[]>;
  private listeners = new Set<() => void>();

  constructor(private config: StoreConfig) {}

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
    const exact: RawUsage[] = [];
    const estimated: RawUsage[] = [];
    const push = (usages: RawUsage[]) => {
      for (const usage of usages) {
        (usage.estimated ? estimated : exact).push(usage);
      }
    };

    const roots = await detectStorageRoots(this.config.extraStorageRoots);
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

    if (this.config.claudeCodeEnabled) {
      for (const file of await findClaudeCodeFiles(defaultClaudeCodeRoot())) {
        push(await this.parseCached(file, () => parseClaudeCodeUsage(file)));
      }
    }

    if (this.config.copilotCliEnabled) {
      for (const file of await findCopilotCliFiles(defaultCopilotCliRoot())) {
        push(
          await this.parseCached(file.filePath, () =>
            parseCopilotCliUsage(file, { charsPerToken: this.config.charsPerToken }),
          ),
        );
      }
    }

    const merged = dedupeBySession(exact, estimated);
    this.events = await this.toEvents(merged);
    for (const listener of this.listeners) {
      listener();
    }
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
