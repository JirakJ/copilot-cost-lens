import { describe, expect, it } from 'vitest';
import { summaryCsv, summaryMarkdown } from '../src/core/summary';
import { MonthReport, RepoSummary } from '../src/types';

function repo(name: string, usd: number, credits: number): RepoSummary {
  return {
    repo: { name },
    requestCount: 2,
    sessionCount: 1,
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 10,
    cacheWriteTokens: 5,
    credits,
    usd,
    hasEstimates: false,
    models: [],
  } as unknown as RepoSummary;
}

function report(): MonthReport {
  return {
    month: '2026-07',
    repos: [repo('owner/alpha', 7.5, 750), repo('b|pipe', 2.5, 250)],
    totalUsd: 10,
    totalCredits: 1000,
    groups: [],
  } as unknown as MonthReport;
}

describe('summaryCsv', () => {
  it('emits one row per repo plus a TOTAL row', () => {
    const csv = summaryCsv(report());
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('repo,requests');
    expect(lines[1]).toContain('owner/alpha');
    expect(lines[3]).toMatch(/^TOTAL,4,2,200,100,20,10,1000.0000,10.0000$/);
  });
});

describe('summaryMarkdown', () => {
  it('builds a table with shares, escaped pipes and currency', () => {
    const md = summaryMarkdown(report(), { code: 'CZK', rate: 20 });
    expect(md).toContain('# AI spend — 2026-07');
    expect(md).toContain('| owner/alpha | 2 | 750.0 | 150.00 CZK | 75.0% |');
    expect(md).toContain('b\\|pipe');
    expect(md).toContain('**200.00 CZK**');
  });
});
