import { creditsToUsd } from './pricing';
import {
  DayPoint,
  ModelSummary,
  MonthReport,
  ProviderSummary,
  RepoSummary,
  UsageEvent,
} from '../types';

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

    const model = modelMap.get(e.model) ?? { model: e.model, credits: 0, usd: 0, requestCount: 0 };
    model.credits += e.credits;
    model.usd = creditsToUsd(model.credits);
    model.requestCount += 1;
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
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
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
    repos,
    models,
    providers,
    days,
    requestCount: inMonth.length,
    sessionCount: sessions.size,
    hasEstimates,
  };
}

export interface RepoDetail {
  summary: RepoSummary;
  days: DayPoint[];
  providers: ProviderSummary[];
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
  let firstActivity = Number.MAX_SAFE_INTEGER;

  for (const e of filtered) {
    firstActivity = Math.min(firstActivity, e.timestamp);
    const day = dayKey(e.timestamp);
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
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
    summary: summarizeRepo(filtered),
    days: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    providers: [...providerMap.values()].sort((a, b) => b.credits - a.credits),
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
    const m = models.get(e.model) ?? { model: e.model, credits: 0, usd: 0, requestCount: 0 };
    m.credits += e.credits;
    m.usd = creditsToUsd(m.credits);
    m.requestCount += 1;
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
