import { MonthReport } from '../types';

/** Last 7 calendar days of spend as unicode blocks, gaps included as zero. */
export function sparkline(report: MonthReport, now = new Date()): string {
  const blocks = '▁▂▃▄▅▆▇█';
  const byDay = new Map(report.days.map((d) => [d.day, d.usd]));
  const values: number[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    values.push(byDay.get(key) ?? 0);
  }
  const max = Math.max(...values);
  if (max <= 0) {
    return '';
  }
  return values
    .map((v) => blocks[Math.min(blocks.length - 1, Math.round((v / max) * (blocks.length - 1)))])
    .join('');
}
