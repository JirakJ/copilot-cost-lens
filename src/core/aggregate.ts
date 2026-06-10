import { creditsToUsd } from './pricing';
import { DayPoint, ModelSummary, MonthReport, RepoSummary, UsageEvent } from '../types';

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

/** Months present in the data, newest first. */
export function availableMonths(events: UsageEvent[]): string[] {
  const months = new Set<string>();
  for (const e of events) {
    months.add(monthKey(e.timestamp));
  }
  return [...months].sort().reverse();
}

export interface ReportOptions {
  month: string;
  includedCredits: number;
  now?: Date;
}

export function buildMonthReport(events: UsageEvent[], options: ReportOptions): MonthReport {
  const inMonth = events.filter((e) => monthKey(e.timestamp) === options.month);

  const repoMap = new Map<string, { events: UsageEvent[] }>();
  const modelMap = new Map<string, ModelSummary>();
  const dayMap = new Map<string, DayPoint>();
  const sessions = new Set<string>();

  let totalCredits = 0;
  let hasEstimates = false;

  for (const e of inMonth) {
    totalCredits += e.credits;
    sessions.add(e.sessionId);
    if (e.costSource === 'estimated') {
      hasEstimates = true;
    }

    const repoKey = e.repo.name;
    const repoEntry = repoMap.get(repoKey) ?? { events: [] };
    repoEntry.events.push(e);
    repoMap.set(repoKey, repoEntry);

    const model = modelMap.get(e.model) ?? { model: e.model, credits: 0, usd: 0, requestCount: 0 };
    model.credits += e.credits;
    model.usd = creditsToUsd(model.credits);
    model.requestCount += 1;
    modelMap.set(e.model, model);

    const day = dayKey(e.timestamp);
    const point = dayMap.get(day) ?? { day, credits: 0, usd: 0 };
    point.credits += e.credits;
    point.usd = creditsToUsd(point.credits);
    dayMap.set(day, point);
  }

  const repos: RepoSummary[] = [...repoMap.values()]
    .map(({ events: repoEvents }) => summarizeRepo(repoEvents))
    .sort((a, b) => b.credits - a.credits);

  const models = [...modelMap.values()].sort((a, b) => b.credits - a.credits);
  const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  const { forecastCredits } = forecast(options.month, totalCredits, days, options.now ?? new Date());

  return {
    month: options.month,
    totalCredits,
    totalUsd: creditsToUsd(totalCredits),
    includedCredits: options.includedCredits,
    usedPercent: options.includedCredits > 0 ? (totalCredits / options.includedCredits) * 100 : 0,
    forecastCredits,
    forecastUsd: creditsToUsd(forecastCredits),
    repos,
    models,
    days,
    requestCount: inMonth.length,
    sessionCount: sessions.size,
    hasEstimates,
  };
}

function summarizeRepo(events: UsageEvent[]): RepoSummary {
  const first = events[0]!;
  const models = new Map<string, ModelSummary>();
  const sessions = new Set<string>();
  let credits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let lastActivity = 0;
  let hasEstimates = false;

  for (const e of events) {
    credits += e.credits;
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cachedTokens += e.cachedTokens;
    sessions.add(e.sessionId);
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
    requestCount: events.length,
    sessionCount: sessions.size,
    models: [...models.values()].sort((a, b) => b.credits - a.credits),
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
  if (month !== currentMonthKey(now) || days.length === 0) {
    return { forecastCredits: totalCredits };
  }
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const elapsed = Math.max(1, now.getDate());
  return { forecastCredits: (totalCredits / elapsed) * daysInMonth };
}
