import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from '../src/core/csv';
import { sparkline } from '../src/core/sparkline';
import { renderDashboardHtml } from '../src/ui/dashboardHtml';
import { MonthReport, UsageEvent } from '../src/types';

function reportWithDays(days: MonthReport['days']): MonthReport {
  return {
    month: '2026-06',
    totalCredits: 0,
    totalUsd: 0,
    copilotCredits: 0,
    copilotUsd: 0,
    includedCredits: 0,
    usedPercent: 0,
    forecastCredits: 0,
    forecastUsd: 0,
    monthsSeries: [],
    repos: [],
    groups: [],
    models: [],
    providers: [],
    days,
    requestCount: 0,
    sessionCount: 0,
    hasEstimates: false,
  };
}

describe('sparkline', () => {
  const now = new Date(2026, 5, 10);

  it('renders the last 7 days with gaps as the lowest block', () => {
    const spark = sparkline(
      reportWithDays([
        { day: '2026-06-04', credits: 100, usd: 1 },
        { day: '2026-06-07', credits: 400, usd: 4 },
        { day: '2026-06-10', credits: 200, usd: 2 },
      ]),
      now,
    );
    expect(spark).toHaveLength(7);
    expect(spark[0]).toBe('▃'); // Jun 4: 1/4 of max
    expect(spark[3]).toBe('█'); // Jun 7: max
    expect(spark[1]).toBe('▁'); // gap
    expect(spark[6]).toBe('▅'); // Jun 10: half of max
  });

  it('returns empty string without spend', () => {
    expect(sparkline(reportWithDays([]), now)).toBe('');
  });

  it('ignores days outside the 7-day window', () => {
    const spark = sparkline(
      reportWithDays([{ day: '2026-06-01', credits: 500, usd: 5 }]),
      now,
    );
    expect(spark).toBe('');
  });
});

describe('toCsv', () => {
  const event: UsageEvent = {
    sessionId: 'sess-1',
    provider: 'claude-code',
    repo: { name: 'acme/repo,with"comma' },
    timestamp: Date.UTC(2026, 5, 10, 12),
    model: 'claude-fable-5',
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 25,
    cacheWriteTokens: 10,
    credits: 12.3456,
    costSource: 'computed',
  };

  it('emits a header and one row per event with escaped fields', () => {
    const csv = toCsv([event]);
    const [header, row] = csv.trimEnd().split('\n');
    expect(header!.split(',')).toContain('cacheWriteTokens');
    expect(row).toContain('"acme/repo,with""comma"');
    expect(row).toContain('claude-code');
    expect(row).toContain('12.3456');
    expect(row).toContain('0.1235'); // USD = credits × 0.01
  });

  it('escapes only fields that need it', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('renderDashboardHtml', () => {
  const strings = { refresh: 'Refresh', projects: 'Projects & <markup>' };

  it('injects the string catalog as JSON', () => {
    const html = renderDashboardHtml(strings);
    expect(html).toContain('"projects":"Projects & <markup>"');
  });

  it('uses a strict CSP with a fresh nonce on every render', () => {
    const first = renderDashboardHtml(strings);
    const second = renderDashboardHtml(strings);
    const nonce = (html: string) => /nonce-([^']+)'/.exec(html)?.[1];
    expect(first).toContain("default-src 'none'");
    expect(nonce(first)).toBeTruthy();
    expect(nonce(first)).not.toBe(nonce(second));
  });

  it('wires the message handlers the controller depends on', () => {
    const html = renderDashboardHtml(strings);
    for (const type of [
      'selectMonth',
      'selectRepo',
      'selectGroup',
      'exportReceipt',
      'exportInvoice',
      'setAllowance',
      'saveGroup',
      'deleteGroup',
      'toggleStar',
      'refresh',
    ]) {
      expect(html, `missing message type ${type}`).toContain(`type: '${type}'`);
    }
  });

  it('contains the inline project editor', () => {
    const html = renderDashboardHtml(strings);
    expect(html).toContain('function openEditor');
    expect(html).toContain('picklist');
    expect(html).toContain('assignedElsewhere');
    expect(html).toContain("originalName: editor.originalName || undefined");
  });
});
