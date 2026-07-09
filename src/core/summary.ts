import { csvField } from './csv';
import { DisplayCurrency, money } from './money';
import { MonthReport } from '../types';

/**
 * Aggregated per-repository summary of a month report — the pivot-friendly
 * counterpart to the raw event exports (CSV for finance, Markdown for
 * standups and status reports).
 */

export function summaryCsv(report: MonthReport): string {
  const header = [
    'repo',
    'requests',
    'sessions',
    'inputTokens',
    'outputTokens',
    'cachedTokens',
    'cacheWriteTokens',
    'credits',
    'usd',
  ];
  const rows = report.repos.map((r) =>
    [
      csvField(r.repo.name),
      r.requestCount,
      r.sessionCount,
      r.inputTokens,
      r.outputTokens,
      r.cachedTokens,
      r.cacheWriteTokens,
      r.credits.toFixed(4),
      r.usd.toFixed(4),
    ].join(','),
  );
  const total = [
    'TOTAL',
    report.repos.reduce((s, r) => s + r.requestCount, 0),
    report.repos.reduce((s, r) => s + r.sessionCount, 0),
    report.repos.reduce((s, r) => s + r.inputTokens, 0),
    report.repos.reduce((s, r) => s + r.outputTokens, 0),
    report.repos.reduce((s, r) => s + r.cachedTokens, 0),
    report.repos.reduce((s, r) => s + r.cacheWriteTokens, 0),
    report.totalCredits.toFixed(4),
    report.totalUsd.toFixed(4),
  ].join(',');
  return [header.join(','), ...rows, total].join('\n') + '\n';
}

export function summaryMarkdown(report: MonthReport, currency: DisplayCurrency): string {
  const lines = [
    `# AI spend — ${report.month}`,
    '',
    '| Repository | Requests | Credits | Spend | Share |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const r of report.repos) {
    const share = report.totalUsd > 0 ? ((r.usd / report.totalUsd) * 100).toFixed(1) + '%' : '—';
    lines.push(
      `| ${r.repo.name.replace(/\|/g, '\\|')} | ${r.requestCount} | ${r.credits.toFixed(1)} | ${money(r.usd, currency)} | ${share} |`,
    );
  }
  lines.push(
    `| **Total** | | **${report.totalCredits.toFixed(1)}** | **${money(report.totalUsd, currency)}** | |`,
  );
  return lines.join('\n') + '\n';
}
