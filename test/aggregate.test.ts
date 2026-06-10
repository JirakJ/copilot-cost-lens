import { describe, expect, it } from 'vitest';
import { availableMonths, buildMonthReport, dayKey, monthKey } from '../src/core/aggregate';
import { UsageEvent } from '../src/types';

function event(partial: Partial<UsageEvent>): UsageEvent {
  return {
    sessionId: 's1',
    repo: { name: 'owner/alpha' },
    timestamp: new Date(2026, 5, 10, 12).getTime(), // 2026-06-10 local
    model: 'gpt-5.5',
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 0,
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
    expect(availableMonths(events)).toEqual(['2026-06', '2026-05']);
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

  it('aggregates per model and per day', () => {
    const events = [
      event({ model: 'gpt-5.5', credits: 4 }),
      event({ model: 'claude-sonnet-4.6', credits: 6, timestamp: new Date(2026, 5, 11).getTime() }),
    ];
    const report = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(report.models[0]!.model).toBe('claude-sonnet-4.6');
    expect(report.days.map((d) => d.day)).toEqual(['2026-06-10', '2026-06-11']);
  });
});
