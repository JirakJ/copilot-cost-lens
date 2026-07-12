import { describe, expect, it } from 'vitest';
import {
  ALL_TIME,
  availableMonths,
  buildGroupDetail,
  buildMonthReport,
  buildRepoDetail,
  dayKey,
  monthKey,
  sessionCosts,
} from '../src/core/aggregate';
import { UsageEvent } from '../src/types';

function event(partial: Partial<UsageEvent>): UsageEvent {
  return {
    sessionId: 's1',
    provider: 'copilot',
    repo: { name: 'owner/alpha' },
    timestamp: new Date(2026, 5, 10, 12).getTime(), // 2026-06-10 local
    model: 'gpt-5.5',
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    credits: 10,
    costSource: 'billed',
    ...partial,
  };
}

describe('keys', () => {
  it('builds local month and day keys', () => {
    const ts = new Date(2026, 0, 5).getTime();
    expect(monthKey(ts)).toBe('2026-01');
    expect(dayKey(ts)).toBe('2026-01-05');
  });
});

describe('availableMonths', () => {
  it('returns unique months, newest first', () => {
    const events = [
      event({ timestamp: new Date(2026, 4, 1).getTime() }),
      event({ timestamp: new Date(2026, 5, 1).getTime() }),
      event({ timestamp: new Date(2026, 5, 20).getTime() }),
    ];
    expect(availableMonths(events, new Date(2026, 5, 10))).toEqual(['2026-06', '2026-05']);
  });

  it('always offers the current month, even without data', () => {
    const events = [event({ timestamp: new Date(2025, 11, 1).getTime() })];
    expect(availableMonths(events, new Date(2026, 5, 10))).toEqual(['2026-06', '2025-12']);
  });
});

describe('buildMonthReport', () => {
  const now = new Date(2026, 5, 10); // June 10

  it('filters by month and totals credits', () => {
    const events = [
      event({ credits: 10 }),
      event({ credits: 5, timestamp: new Date(2026, 4, 1).getTime() }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.totalCredits).toBe(10);
    expect(report.totalUsd).toBeCloseTo(0.1);
    expect(report.requestCount).toBe(1);
  });

  it('sums per-day tokens across all token buckets', () => {
    const events = [
      event({ inputTokens: 1000, outputTokens: 200, cachedTokens: 50, cacheWriteTokens: 10 }),
      event({ inputTokens: 500, outputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, sessionId: 's2' }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    const today = report.days.find((d) => d.day === '2026-06-10');
    expect(today?.tokens).toBe(1860);
  });

  it('ranks repositories by cost', () => {
    const events = [
      event({ repo: { name: 'owner/alpha' }, credits: 1 }),
      event({ repo: { name: 'owner/beta' }, credits: 9, sessionId: 's2' }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.repos.map((r) => r.repo.name)).toEqual(['owner/beta', 'owner/alpha']);
    expect(report.sessionCount).toBe(2);
  });

  it('computes allowance percentage and linear forecast', () => {
    const report = buildMonthReport([event({ credits: 190 })], {
      month: '2026-06',
      includedCredits: 1900,
      now,
    });
    expect(report.usedPercent).toBeCloseTo(10);
    // 190 credits in 10 of 30 days → 570 forecast
    expect(report.forecastCredits).toBeCloseTo(570);
  });

  it('uses actual totals as forecast for past months', () => {
    const report = buildMonthReport(
      [event({ credits: 50, timestamp: new Date(2026, 4, 2).getTime() })],
      { month: '2026-05', includedCredits: 1900, now },
    );
    expect(report.forecastCredits).toBe(50);
  });

  it('flags estimates', () => {
    const report = buildMonthReport([event({ costSource: 'estimated' })], {
      month: '2026-06',
      includedCredits: 1900,
      now,
    });
    expect(report.hasEstimates).toBe(true);
    expect(report.repos[0]!.hasEstimates).toBe(true);
  });

  it('splits providers and excludes Claude Code from the allowance', () => {
    const events = [
      event({ credits: 100, provider: 'copilot' }),
      event({ credits: 50, provider: 'copilot-cli', sessionId: 's2' }),
      event({ credits: 900, provider: 'claude-code', sessionId: 's3' }),
      event({ credits: 300, provider: 'codex', sessionId: 's4' }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.totalCredits).toBe(1350);
    expect(report.copilotCredits).toBe(150);
    expect(report.usedPercent).toBeCloseTo((150 / 1900) * 100);
    expect(report.providers.map((p) => p.provider)).toEqual(['claude-code', 'codex', 'copilot', 'copilot-cli']);
  });

  it('sums cache tokens per repository', () => {
    const events = [
      event({ cachedTokens: 100, cacheWriteTokens: 40 }),
      event({ cachedTokens: 50, cacheWriteTokens: 10 }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.repos[0]!.cachedTokens).toBe(150);
    expect(report.repos[0]!.cacheWriteTokens).toBe(50);
  });

  it('aggregates per model and per day', () => {
    const events = [
      event({ model: 'gpt-5.5', credits: 4 }),
      event({ model: 'claude-sonnet-4.6', credits: 6, timestamp: new Date(2026, 5, 11).getTime() }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.models[0]!.model).toBe('claude-sonnet-4.6');
    expect(report.days.map((d) => d.day)).toEqual(['2026-06-10', '2026-06-11']);
  });

  it('reports previous-month spend for trend display', () => {
    const events = [
      event({ credits: 200, timestamp: new Date(2026, 4, 5).getTime() }),
      event({ credits: 100 }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.prevMonth).toBe('2026-05');
    expect(report.prevMonthUsd).toBeCloseTo(2);
  });

  it('predicts the allowance exhaustion date at current pace', () => {
    // 1000 credits in 10 days → 100/day → 1900 exhausted on day 19
    const report = buildMonthReport([event({ credits: 1000 })], {
      month: '2026-06',
      includedCredits: 1900,
      now,
    });
    expect(report.allowanceExhaustion).toBe('2026-06-19');
    // slow pace → fits within the month → no exhaustion warning
    const slow = buildMonthReport([event({ credits: 100 })], {
      month: '2026-06',
      includedCredits: 1900,
      now,
    });
    expect(slow.allowanceExhaustion).toBeUndefined();
  });

  it('builds the all-time months series', () => {
    const events = [
      event({ credits: 5, timestamp: new Date(2026, 4, 1).getTime() }),
      event({ credits: 10 }),
    ];
    const report = buildMonthReport(events, { month: ALL_TIME, includedCredits: 0, now });
    expect(report.monthsSeries.map((m) => m.month)).toEqual(['2026-05', '2026-06']);
    expect(report.monthsSeries[1]!.credits).toBe(10);
  });

  it('builds a 26-week daily heatmap aligned to today', () => {
    const today = new Date(2026, 5, 10, 9);
    const events = [
      event({ credits: 30, timestamp: new Date(2026, 5, 10, 8).getTime() }), // today
      event({ credits: 7, timestamp: new Date(2026, 5, 9, 8).getTime() }), // yesterday
      event({ credits: 99, timestamp: new Date(2025, 0, 1).getTime() }), // long ago — excluded
    ];
    const report = buildMonthReport(events, { month: ALL_TIME, includedCredits: 0, now: today });
    expect(report.heatmap).toHaveLength(26 * 7);
    expect(report.heatmap.at(-1)!.day).toBe('2026-06-10');
    expect(report.heatmap.at(-1)!.credits).toBe(30);
    expect(report.heatmap.at(-2)!.credits).toBe(7);
    expect(report.heatmap.reduce((s, d) => s + d.credits, 0)).toBe(37); // old event excluded
  });

  it('covers everything in the all-time view and disables the allowance', () => {
    const events = [
      event({ credits: 10, timestamp: new Date(2025, 9, 1).getTime() }),
      event({ credits: 20 }),
    ];
    const report = buildMonthReport(events, { month: ALL_TIME, includedCredits: 1900, now });
    expect(report.totalCredits).toBe(30);
    expect(report.includedCredits).toBe(0);
    expect(report.forecastCredits).toBe(30); // no extrapolation for all-time
  });
});

describe('project groups', () => {
  const now = new Date(2026, 5, 10);
  const groupEvents = [
    event({ repo: { name: 'acme/frontend' }, credits: 10, model: 'gpt-5.5' }),
    event({ repo: { name: 'acme/backend' }, credits: 20, model: 'gpt-5.5', sessionId: 's2' }),
    event({
      repo: { name: 'e2e-tests', folderPath: '/Users/dev/work/e2e-tests' },
      credits: 5,
      model: 'claude-sonnet-4.6',
      sessionId: 's3',
      provider: 'claude-code',
    }),
    event({ repo: { name: 'acme/unrelated' }, credits: 99, sessionId: 's4' }),
  ];
  const groups = { MyProduct: ['acme/frontend', 'ACME/backend', 'e2e-tests'] };

  it('aggregates member repos into a group, case-insensitively', () => {
    const report = buildMonthReport(groupEvents, { month: '2026-06', includedCredits: 0, groups, now });
    expect(report.groups).toHaveLength(1);
    const group = report.groups[0]!;
    expect(group.credits).toBe(35);
    expect(group.repos.map((r) => r.repo.name).sort()).toEqual([
      'acme/backend',
      'acme/frontend',
      'e2e-tests',
    ]);
    expect(group.models.map((m) => m.model)).toEqual(['gpt-5.5', 'claude-sonnet-4.6']);
  });

  it('omits groups with no usage in the period', () => {
    const report = buildMonthReport(groupEvents, {
      month: '2025-01',
      includedCredits: 0,
      groups,
      now,
    });
    expect(report.groups).toHaveLength(0);
  });

  it('builds a drill-down detail with per-provider split', () => {
    const detail = buildGroupDetail(groupEvents, {
      name: 'MyProduct',
      members: groups.MyProduct,
      month: ALL_TIME,
    })!;
    expect(detail.group.credits).toBe(35);
    expect(detail.providers.map((p) => p.provider)).toEqual(['copilot', 'claude-code']);
    expect(detail.days).toHaveLength(1);
  });
});

describe('buildRepoDetail', () => {
  const now = new Date(2026, 5, 10);

  it('returns per-repo days, providers and summary', () => {
    const events = [
      event({ credits: 5, provider: 'copilot' }),
      event({ credits: 7, provider: 'claude-code', timestamp: new Date(2026, 5, 11).getTime() }),
      event({ repo: { name: 'owner/other' }, credits: 99 }),
    ];
    const detail = buildRepoDetail(events, { repoName: 'owner/alpha', month: '2026-06' })!;
    expect(detail.summary.credits).toBe(12);
    expect(detail.days).toHaveLength(2);
    expect(detail.providers.map((p) => p.provider)).toEqual(['claude-code', 'copilot']);
    expect(detail.firstActivity).toBe(new Date(2026, 5, 10, 12).getTime());
  });

  it('ranks the most expensive sessions', () => {
    const events = [
      event({ sessionId: 'cheap', credits: 1 }),
      event({ sessionId: 'big', credits: 50, model: 'gpt-5.5' }),
      event({ sessionId: 'big', credits: 30, model: 'claude-sonnet-4.6' }),
    ];
    const detail = buildRepoDetail(events, { repoName: 'owner/alpha', month: '2026-06' })!;
    expect(detail.topSessions[0]!.sessionId).toBe('big');
    expect(detail.topSessions[0]!.credits).toBe(80);
    expect(detail.topSessions[0]!.models.sort()).toEqual(['claude-sonnet-4.6', 'gpt-5.5']);
    expect(detail.topSessions).toHaveLength(2);
  });

  it('supports the all-time period and unknown repos', () => {
    const events = [
      event({ credits: 5, timestamp: new Date(2025, 0, 1).getTime() }),
      event({ credits: 5 }),
    ];
    const detail = buildRepoDetail(events, { repoName: 'owner/alpha', month: ALL_TIME })!;
    expect(detail.summary.credits).toBe(10);
    expect(buildRepoDetail(events, { repoName: 'nope', month: ALL_TIME })).toBeUndefined();
  });
});

describe('sessionCosts', () => {
  it('sums credits per session and tags the most recent repo', () => {
    const t1 = new Date(2026, 5, 10, 12).getTime();
    const events = [
      event({ sessionId: 'a', credits: 100, timestamp: t1 }),
      event({ sessionId: 'a', credits: 150, timestamp: t1 + 1000, repo: { name: 'owner/beta' } }),
      event({ sessionId: 'b', credits: 5 }),
    ];
    const costs = sessionCosts(events);
    const a = costs.find((s) => s.sessionId === 'a')!;
    expect(a.credits).toBe(250);
    expect(a.usd).toBeCloseTo(2.5);
    expect(a.repoName).toBe('owner/beta');
    expect(costs.find((s) => s.sessionId === 'b')!.usd).toBeCloseTo(0.05);
  });
});
