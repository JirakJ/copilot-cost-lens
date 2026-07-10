import { MonthReport } from '../types';

/** Local-timezone YYYY-MM-DD key matching MonthReport.days entries. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Spend recorded today (local time), 0 when nothing yet. */
export function todayUsd(report: MonthReport, now = new Date()): number {
  const key = dayKey(now);
  return report.days.filter((d) => d.day === key).reduce((sum, d) => sum + d.usd, 0);
}

/** Last 7 calendar days of spend as unicode blocks, gaps included as zero. */
export function sparkline(report: MonthReport, now = new Date()): string {
  const blocks = '▁▂▃▄▅▆▇█';
  const byDay = new Map(report.days.map((d) => [d.day, d.usd]));
  const values: number[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    values.push(byDay.get(dayKey(date)) ?? 0);
  }
  const max = Math.max(...values);
  if (max <= 0) {
    return '';
  }
  return values
    .map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))])
    .join('');
}
