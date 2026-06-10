/** How the cost of a usage event was determined. */
export type CostSource =
  /** AI Credits reported directly by Copilot logs (authoritative). */
  | 'billed'
  /** Computed from exact token counts in logs using the model price table. */
  | 'computed'
  /** Estimated from chat content length (no token data available). */
  | 'estimated';

/** A single billable interaction (one model request or one chat turn). */
export interface UsageEvent {
  /** Chat session id this event belongs to. */
  sessionId: string;
  /** Stable identity of the repository / workspace folder. */
  repo: RepoRef;
  /** Unix epoch ms. */
  timestamp: number;
  /** Normalized model id, e.g. "gpt-5.3-codex". */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** AI Credits (1 credit = $0.01). Always populated by the pricing engine. */
  credits: number;
  costSource: CostSource;
}

export interface RepoRef {
  /** Display name, e.g. "owner/repo" when a git remote is known, else folder name. */
  name: string;
  /** Absolute path of the workspace folder, when resolvable. */
  folderPath?: string;
  /** Git remote slug like "owner/repo", when resolvable. */
  remoteSlug?: string;
}

/** Raw usage extracted by a source, before pricing. */
export interface RawUsage {
  sessionId: string;
  workspaceStorageDir: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** copilotUsageNanoAiu when present: nano AI-credit units, 1e9 = 1 credit. */
  nanoCredits?: number;
  /** True when token counts were estimated from text length. */
  estimated: boolean;
}

export interface ModelRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M cached input tokens. */
  cachedInput: number;
  /** USD per 1M cache-write tokens (Anthropic models). */
  cacheWrite?: number;
  /** USD per 1M output tokens. */
  output: number;
}

export interface RepoSummary {
  repo: RepoRef;
  credits: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
  sessionCount: number;
  models: ModelSummary[];
  lastActivity: number;
  /** True when any part of the total is an estimate. */
  hasEstimates: boolean;
}

export interface ModelSummary {
  model: string;
  credits: number;
  usd: number;
  requestCount: number;
}

export interface DayPoint {
  /** ISO date (YYYY-MM-DD), local time. */
  day: string;
  credits: number;
  usd: number;
}

export interface MonthReport {
  /** YYYY-MM, local time. */
  month: string;
  totalCredits: number;
  totalUsd: number;
  includedCredits: number;
  /** Percentage 0..N of the included allowance used. */
  usedPercent: number;
  /** Naive linear forecast of total credits at end of month. */
  forecastCredits: number;
  forecastUsd: number;
  repos: RepoSummary[];
  models: ModelSummary[];
  days: DayPoint[];
  requestCount: number;
  sessionCount: number;
  hasEstimates: boolean;
}
