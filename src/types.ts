/** Where a usage event came from. */
export type Provider = 'copilot' | 'copilot-cli' | 'claude-code';

/** How the cost of a usage event was determined. */
export type CostSource =
  /** Billed units reported directly by logs (AI-credit nano units or premium requests). */
  | 'billed'
  /** Computed from exact token counts in logs using the model price table. */
  | 'computed'
  /** Estimated from chat content length (no token data available). */
  | 'estimated';

/** A single billable interaction (one model request, turn or session-run slice). */
export interface UsageEvent {
  /** Chat session id this event belongs to. */
  sessionId: string;
  provider: Provider;
  /** Stable identity of the repository / workspace folder. */
  repo: RepoRef;
  /** Unix epoch ms. */
  timestamp: number;
  /** Normalized model id, e.g. "gpt-5.3-codex". */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cache read (cached input) tokens. */
  cachedTokens: number;
  /** Cache write (cache creation) tokens. */
  cacheWriteTokens: number;
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
  provider: Provider;
  /** VS Code workspaceStorage dir — repo resolved via workspace.json. */
  workspaceStorageDir?: string;
  /** Direct workspace folder path — repo resolved via .git/config. */
  folderPath?: string;
  /** Direct "owner/repo" slug when the log already carries it. */
  repoSlug?: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  /** copilotUsageNanoAiu when present: nano AI-credit units, 1e9 = 1 credit. */
  nanoCredits?: number;
  /** Billed premium requests (pre-June-2026 Copilot billing), 1 = $0.04. */
  premiumRequests?: number;
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
  /** Higher rates applied when a request's context exceeds the threshold. */
  longContext?: {
    /** Context size (input + cache reads) in tokens that triggers the tier. */
    threshold: number;
    input: number;
    cachedInput: number;
    output: number;
  };
}

export interface RepoSummary {
  repo: RepoRef;
  credits: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  sessionCount: number;
  models: ModelSummary[];
  providers: Provider[];
  lastActivity: number;
  /** True when any part of the total is an estimate. */
  hasEstimates: boolean;
}

export interface ModelSummary {
  model: string;
  credits: number;
  usd: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}

export interface ProviderSummary {
  provider: Provider;
  credits: number;
  usd: number;
  requestCount: number;
}

/** A user-defined project: several repositories rolled into one. */
export interface GroupSummary {
  name: string;
  /** Member repositories that actually have usage in the period. */
  repos: RepoSummary[];
  credits: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  sessionCount: number;
  models: ModelSummary[];
  hasEstimates: boolean;
}

export interface DayPoint {
  /** ISO date (YYYY-MM-DD), local time. */
  day: string;
  credits: number;
  usd: number;
}

export interface MonthPoint {
  /** YYYY-MM, local time. */
  month: string;
  credits: number;
  usd: number;
}

/** One chat session ranked inside a repository detail. */
export interface SessionSummary {
  sessionId: string;
  provider: Provider;
  credits: number;
  usd: number;
  requestCount: number;
  models: string[];
  lastTimestamp: number;
}

export interface MonthReport {
  /** YYYY-MM, local time. */
  month: string;
  totalCredits: number;
  totalUsd: number;
  /** Credits consumed by GitHub Copilot only (counts against the allowance). */
  copilotCredits: number;
  copilotUsd: number;
  includedCredits: number;
  /** Percentage 0..N of the included Copilot allowance used. */
  usedPercent: number;
  /** Naive linear forecast of total credits at end of month. */
  forecastCredits: number;
  forecastUsd: number;
  /** Spend of the previous calendar month (undefined for all-time). */
  prevMonth?: string;
  prevMonthUsd?: number;
  /** Projected date (YYYY-MM-DD) the Copilot allowance runs out at current pace. */
  allowanceExhaustion?: string;
  /** Per-month series across all data — used by the all-time chart. */
  monthsSeries: MonthPoint[];
  repos: RepoSummary[];
  /** User-defined project groups with usage in the period (empty when none configured). */
  groups: GroupSummary[];
  models: ModelSummary[];
  providers: ProviderSummary[];
  days: DayPoint[];
  requestCount: number;
  sessionCount: number;
  hasEstimates: boolean;
}
