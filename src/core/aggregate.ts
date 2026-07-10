import { creditsToUsd } from './pricing';
import {
  DayPoint,
  GroupSummary,
  ModelSummary,
  MonthPoint,
  MonthReport,
  ProviderSummary,
  RepoSummary,
  SessionSummary,
  UsageEvent,
} from '../types';

/** User-defined project groups: name → member repo identifiers. */
export type ProjectGroups = Record<string, string[]>;

/** YYYY-MM in local time. */
export function monthKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM-DD in local time. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${monthKey(timestamp)}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonthKey(now = new Date()): string {
  return monthKey(now.getTime());
}

/** Months present in the data plus the current month, newest first. */
export function availableMonths(events: UsageEvent[], now = new Date()): string[] {
  const months = new Set<string>([currentMonthKey(now)]);
  for (const e of events) {
    months.add(monthKey(e.timestamp));
  }
  return [...months].sort().reverse();
}

/** Sentinel period covering everything since the first recorded event. */
export const ALL_TIME = 'all';

export interface ReportOptions {
  /** YYYY-MM or ALL_TIME. */
  month: string;
  includedCredits: number;
  groups?: ProjectGroups;
  now?: Date;
}

export function buildMonthReport(events: UsageEvent[], options: ReportOptions): MonthReport {
  const inMonth =
    options.month === ALL_TIME
      ? events
      : events.filter((e) => monthKey(e.timestamp) === options.month);

  const repoMap = new Map<string, UsageEvent[]>();
  const modelMap = new Map<string, ModelSummary>();
  const providerMap = new Map<string, ProviderSummary>();
  const dayMap = new Map<string, DayPoint>();
  const sessions = new Set<string>();

  let totalCredits = 0;
  let copilotCredits = 0;
  let hasEstimates = false;

  for (const e of inMonth) {
    totalCredits += e.credits;
    if (e.provider !== 'claude-code') {
      copilotCredits += e.credits;
    }
    sessions.add(e.sessionId);
    if (e.costSource === 'estimated') {
      hasEstimates = true;
    }

    const repoEvents = repoMap.get(e.repo.name) ?? [];
    repoEvents.push(e);
    repoMap.set(e.repo.name, repoEvents);

    const model = modelMap.get(e.model) ?? emptyModelSummary(e.model);
    addToModelSummary(model, e);
    modelMap.set(e.model, model);

    const provider = providerMap.get(e.provider) ?? {
      provider: e.provider,
      credits: 0,
      usd: 0,
      requestCount: 0,
    };
    provider.credits += e.credits;
    provider.usd = creditsToUsd(provider.credits);
    provider.requestCount += 1;
    providerMap.set(e.provider, provider);

    const day = dayKey(e.timestamp);
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0, tokens: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
    point.tokens += eventTokens(e);
    dayMap.set(day, point);
  }

  const repos: RepoSummary[] = [...repoMap.values()]
    .map((repoEvents) => summarizeRepo(repoEvents))
    .sort((a, b) => b.credits - a.credits);

  const models = [...modelMap.values()].sort((a, b) => b.credits - a.credits);
  const providers = [...providerMap.values()].sort((a, b) => b.credits - a.credits);
  const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const { forecastCredits } = forecast(options.month, totalCredits, days, options.now ?? new Date());

  // a monthly allowance is meaningless for the all-time view
  const includedCredits = options.month === ALL_TIME ? 0 : options.includedCredits;
  const now = options.now ?? new Date();

  let prevMonth: string | undefined;
  let prevMonthUsd: number | undefined;
  if (options.month !== ALL_TIME) {
    prevMonth = previousMonthKey(options.month);
    let prevCredits = 0;
    for (const e of events) {
      if (monthKey(e.timestamp) === prevMonth) {
        prevCredits += e.credits;
      }
    }
    prevMonthUsd = creditsToUsd(prevCredits);
  }

  return {
    month: options.month,
    totalCredits,
    totalUsd: creditsToUsd(totalCredits),
    copilotCredits,
    copilotUsd: creditsToUsd(copilotCredits),
    includedCredits,
    usedPercent: includedCredits > 0 ? (copilotCredits / includedCredits) * 100 : 0,
    forecastCredits,
    forecastUsd: creditsToUsd(forecastCredits),
    prevMonth,
    prevMonthUsd,
    allowanceExhaustion: allowanceExhaustion(options.month, copilotCredits, includedCredits, now),
    monthsSeries: buildMonthsSeries(events),
    heatmap: buildHeatmap(events, now),
    repos,
    groups: buildGroupSummaries(repos, options.groups ?? {}),
    models,
    providers,
    days,
    requestCount: inMonth.length,
    sessionCount: sessions.size,
    hasEstimates,
  };
}

function emptyModelSummary(model: string): ModelSummary {
  return {
    model,
    credits: 0,
    usd: 0,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
  };
}

function addToModelSummary(summary: ModelSummary, e: UsageEvent): void {
  summary.credits += e.credits;
  summary.usd = creditsToUsd(summary.credits);
  summary.requestCount += 1;
  summary.inputTokens += e.inputTokens;
  summary.outputTokens += e.outputTokens;
  summary.cachedTokens += e.cachedTokens;
  summary.cacheWriteTokens += e.cacheWriteTokens;
}

function eventTokens(e: UsageEvent): number {
  return e.inputTokens + e.outputTokens + e.cachedTokens + e.cacheWriteTokens;
}

export function previousMonthKey(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 2, 1);
  return monthKey(date.getTime());
}

/** Daily spend for the last `weeks` weeks (aligned to whole days), all sources. */
export function buildHeatmap(events: UsageEvent[], now = new Date(), weeks = 26): DayPoint[] {
  const days = weeks * 7;
  const totals = new Map<string, { credits: number; tokens: number }>();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  for (const e of events) {
    if (e.timestamp >= start) {
      const key = dayKey(e.timestamp);
      const t = totals.get(key) ?? { credits: 0, tokens: 0 };
      t.credits += e.credits;
      t.tokens += eventTokens(e);
      totals.set(key, t);
    }
  }
  const out: DayPoint[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1) + i);
    const key = dayKey(d.getTime());
    const t = totals.get(key) ?? { credits: 0, tokens: 0 };
    out.push({ day: key, credits: t.credits, usd: creditsToUsd(t.credits), tokens: t.tokens });
  }
  return out;
}

function buildMonthsSeries(events: UsageEvent[]): MonthPoint[] {
  const map = new Map<string, MonthPoint>();
  for (const e of events) {
    const month = monthKey(e.timestamp);
    const point = map.get(month) ?? { month, credits: 0, usd: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
    map.set(month, point);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Projected day the Copilot allowance runs out, extrapolating the
 * month-to-date burn rate. Only meaningful for the current month.
 */
function allowanceExhaustion(
  month: string,
  copilotCredits: number,
  includedCredits: number,
  now: Date,
): string | undefined {
  if (month !== currentMonthKey(now) || includedCredits <= 0 || copilotCredits <= 0) {
    return undefined;
  }
  const elapsed = Math.max(1, now.getDate());
  const pace = copilotCredits / elapsed;
  const exhaustDay = includedCredits / pace;
  const [yearStr, monthStr] = month.split('-');
  const daysInMonth = new Date(Number(yearStr), Number(monthStr), 0).getDate();
  if (exhaustDay > daysInMonth) {
    return undefined; // fits within the month at current pace
  }
  return dayKey(new Date(Number(yearStr), Number(monthStr) - 1, Math.max(1, Math.ceil(exhaustDay))).getTime());
}

/** True when a repo summary matches a group member identifier. */
function repoMatches(repo: RepoSummary, member: string): boolean {
  const target = member.trim().toLowerCase();
  if (!target) {
    return false;
  }
  const candidates = [
    repo.repo.name,
    repo.repo.remoteSlug,
    repo.repo.folderPath?.split('/').pop(),
  ];
  return candidates.some((c) => c && c.toLowerCase() === target);
}

export function buildGroupSummaries(repos: RepoSummary[], groups: ProjectGroups): GroupSummary[] {
  const summaries: GroupSummary[] = [];
  for (const [name, members] of Object.entries(groups)) {
    const matched = repos.filter((repo) => members.some((m) => repoMatches(repo, m)));
    if (matched.length === 0) {
      continue;
    }
    const models = new Map<string, ModelSummary>();
    const group: GroupSummary = {
      name,
      repos: matched,
      credits: 0,
      usd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      requestCount: 0,
      sessionCount: 0,
      models: [],
      hasEstimates: false,
    };
    for (const repo of matched) {
      group.credits += repo.credits;
      group.inputTokens += repo.inputTokens;
      group.outputTokens += repo.outputTokens;
      group.cachedTokens += repo.cachedTokens;
      group.cacheWriteTokens += repo.cacheWriteTokens;
      group.requestCount += repo.requestCount;
      group.sessionCount += repo.sessionCount;
      group.hasEstimates ||= repo.hasEstimates;
      for (const m of repo.models) {
        const existing = models.get(m.model) ?? emptyModelSummary(m.model);
        existing.credits += m.credits;
        existing.usd = creditsToUsd(existing.credits);
        existing.requestCount += m.requestCount;
        existing.inputTokens += m.inputTokens;
        existing.outputTokens += m.outputTokens;
        existing.cachedTokens += m.cachedTokens;
        existing.cacheWriteTokens += m.cacheWriteTokens;
        models.set(m.model, existing);
      }
    }
    group.usd = creditsToUsd(group.credits);
    group.models = [...models.values()].sort((a, b) => b.credits - a.credits);
    summaries.push(group);
  }
  return summaries.sort((a, b) => b.credits - a.credits);
}

export interface GroupDetail {
  group: GroupSummary;
  days: DayPoint[];
  providers: ProviderSummary[];
  month: string;
}

/** Drill-down detail for a project group within a period. */
export function buildGroupDetail(
  events: UsageEvent[],
  options: { name: string; members: string[]; month: string; groups?: ProjectGroups },
): GroupDetail | undefined {
  const report = buildMonthReport(events, {
    month: options.month,
    includedCredits: 0,
    groups: { [options.name]: options.members },
  });
  const group = report.groups.find((g) => g.name === options.name);
  if (!group) {
    return undefined;
  }

  const memberNames = new Set(group.repos.map((r) => r.repo.name));
  const inScope = events.filter(
    (e) =>
      memberNames.has(e.repo.name) &&
      (options.month === ALL_TIME || monthKey(e.timestamp) === options.month),
  );

  const dayMap = new Map<string, DayPoint>();
  const providerMap = new Map<string, ProviderSummary>();
  for (const e of inScope) {
    const day = dayKey(e.timestamp);
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0, tokens: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
    point.tokens += eventTokens(e);
    dayMap.set(day, point);

    const provider = providerMap.get(e.provider) ?? {
      provider: e.provider,
      credits: 0,
      usd: 0,
      requestCount: 0,
    };
    provider.credits += e.credits;
    provider.usd = creditsToUsd(provider.credits);
    provider.requestCount += 1;
    providerMap.set(e.provider, provider);
  }

  return {
    group,
    days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    providers: [...providerMap.values()].sort((a, b) => b.credits - a.credits),
    month: options.month,
  };
}

export interface RepoDetail {
  summary: RepoSummary;
  days: DayPoint[];
  providers: ProviderSummary[];
  /** Most expensive chat sessions in the period, descending. */
  topSessions: SessionSummary[];
  firstActivity: number;
  /** Period the detail covers: YYYY-MM or ALL_TIME. */
  month: string;
}

/** Drill-down detail for one repository within a period. */
export function buildRepoDetail(
  events: UsageEvent[],
  options: { repoName: string; month: string },
): RepoDetail | undefined {
  const filtered = events.filter(
    (e) =>
      e.repo.name === options.repoName &&
      (options.month === ALL_TIME || monthKey(e.timestamp) === options.month),
  );
  if (filtered.length === 0) {
    return undefined;
  }

  const dayMap = new Map<string, DayPoint>();
  const providerMap = new Map<string, ProviderSummary>();
  const sessionMap = new Map<string, SessionSummary>();
  let firstActivity = Number.MAX_SAFE_INTEGER;

  for (const e of filtered) {
    firstActivity = Math.min(firstActivity, e.timestamp);
    const day = dayKey(e.timestamp);
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0, tokens: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
    point.tokens += eventTokens(e);
    dayMap.set(day, point);

    const provider = providerMap.get(e.provider) ?? {
      provider: e.provider,
      credits: 0,
      usd: 0,
      requestCount: 0,
    };
    provider.credits += e.credits;
    provider.usd = creditsToUsd(provider.credits);
    provider.requestCount += 1;
    providerMap.set(e.provider, provider);

    const session = sessionMap.get(e.sessionId) ?? {
      sessionId: e.sessionId,
      provider: e.provider,
      credits: 0,
      usd: 0,
      requestCount: 0,
      models: [],
      lastTimestamp: 0,
    };
    session.credits += e.credits;
    session.usd = creditsToUsd(session.credits);
    session.requestCount += 1;
    session.lastTimestamp = Math.max(session.lastTimestamp, e.timestamp);
    if (!session.models.includes(e.model)) {
      session.models.push(e.model);
    }
    sessionMap.set(e.sessionId, session);
  }

  return {
    summary: summarizeRepo(filtered),
    days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    providers: [...providerMap.values()].sort((a, b) => b.credits - a.credits),
    topSessions: [...sessionMap.values()]
      .sort((a, b) => b.credits - a.credits)
      .slice(0, 5),
    firstActivity,
    month: options.month,
  };
}

function summarizeRepo(events: UsageEvent[]): RepoSummary {
  const first = events[0]!;
  const models = new Map<string, ModelSummary>();
  const providers = new Set<UsageEvent['provider']>();
  const sessions = new Set<string>();
  let credits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let cacheWriteTokens = 0;
  let lastActivity = 0;
  let hasEstimates = false;

  for (const e of events) {
    credits += e.credits;
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cachedTokens += e.cachedTokens;
    cacheWriteTokens += e.cacheWriteTokens;
    sessions.add(e.sessionId);
    providers.add(e.provider);
    lastActivity = Math.max(lastActivity, e.timestamp);
    if (e.costSource === 'estimated') {
      hasEstimates = true;
    }
    const m = models.get(e.model) ?? emptyModelSummary(e.model);
    addToModelSummary(m, e);
    models.set(e.model, m);
  }

  return {
    repo: first.repo,
    credits,
    usd: creditsToUsd(credits),
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheWriteTokens,
    requestCount: events.length,
    sessionCount: sessions.size,
    models: [...models.values()].sort((a, b) => b.credits - a.credits),
    providers: [...providers].sort(),
    lastActivity,
    hasEstimates,
  };
}

/**
 * Linear end-of-month forecast. For the current month it extrapolates
 * month-to-date spend over elapsed calendar days; for past months it
 * returns the actual total.
 */
function forecast(
  month: string,
  totalCredits: number,
  days: DayPoint[],
  now: Date,
): { forecastCredits: number } {
  if (month === ALL_TIME || month !== currentMonthKey(now) || days.length === 0) {
    return { forecastCredits: totalCredits };
  }
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const elapsed = Math.max(1, now.getDate());
  return { forecastCredits: (totalCredits / elapsed) * daysInMonth };
}

export interface SessionCost {
  sessionId: string;
  credits: number;
  usd: number;
  /** Repo of the session's most recent event. */
  repoName: string;
  provider: string;
  lastTimestamp: number;
}

/** Total cost per session across all events — used for runaway-session alerts. */
export function sessionCosts(events: UsageEvent[]): SessionCost[] {
  const map = new Map<string, SessionCost>();
  for (const event of events) {
    let entry = map.get(event.sessionId);
    if (!entry) {
      entry = {
        sessionId: event.sessionId,
        credits: 0,
        usd: 0,
        repoName: event.repo.name,
        provider: event.provider,
        lastTimestamp: 0,
      };
      map.set(event.sessionId, entry);
    }
    entry.credits += event.credits;
    if (event.timestamp >= entry.lastTimestamp) {
      entry.lastTimestamp = event.timestamp;
      entry.repoName = event.repo.name;
    }
  }
  for (const entry of map.values()) {
    entry.usd = creditsToUsd(entry.credits);
  }
  return [...map.values()];
}
