/** Sentinel period covering everything since the first recorded event. */
export const ALL_TIME = 'all';

/** Prefix of a custom range key: `range:YYYY-MM-DD..YYYY-MM-DD`. */
export const RANGE_PREFIX = 'range:';

export type PeriodKind = 'month' | 'range' | 'all';

export interface Period {
  key: string;
  kind: PeriodKind;
  /** True when an event timestamp falls inside this period. */
  match(timestamp: number): boolean;
  /** Preceding window of equal length, for deltas. Undefined for all-time. */
  prevKey?: string;
}

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

/** YYYY-MM-DD of a local Date. */
export function isoDay(d: Date): string {
  return dayKey(d.getTime());
}

export function previousMonthKey(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Number(yearStr), Number(monthStr) - 2, 1);
  return monthKey(date.getTime());
}

export function rangeKey(fromIso: string, toIso: string): string {
  return `${RANGE_PREFIX}${fromIso}..${toIso}`;
}

/** Local midnight of an ISO day, or undefined when the date does not exist. */
function parseDay(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    return undefined;
  }
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  // reject rollovers like 2026-13-01 or 2026-02-31
  if (d.getFullYear() !== year || d.getMonth() !== monthIndex || d.getDate() !== day) {
    return undefined;
  }
  return d;
}

function addDays(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/**
 * Resolve a period selector key. Accepts `all`, `YYYY-MM` and
 * `range:YYYY-MM-DD..YYYY-MM-DD` (inclusive whole local days).
 * Anything unparseable falls back to the current month — the dashboard must
 * never render an error state because of a bad key.
 */
export function parsePeriod(key: string, now = new Date()): Period {
  if (key === ALL_TIME) {
    return { key: ALL_TIME, kind: 'all', match: () => true };
  }

  if (key.startsWith(RANGE_PREFIX)) {
    const [fromIso, toIso, extra] = key.slice(RANGE_PREFIX.length).split('..');
    const from = parseDay(fromIso ?? '');
    const to = parseDay(toIso ?? '');
    if (from && to && extra === undefined && from.getTime() <= to.getTime()) {
      const start = from.getTime();
      const endExclusive = addDays(to, 1).getTime();
      // Math.round absorbs the ±1h a DST boundary puts into the span.
      const days = Math.round((endExclusive - start) / 86_400_000);
      return {
        key,
        kind: 'range',
        match: (ts) => ts >= start && ts < endExclusive,
        prevKey: rangeKey(isoDay(addDays(from, -days)), isoDay(addDays(from, -1))),
      };
    }
    return parsePeriod(monthKey(now.getTime()), now);
  }

  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    return {
      key,
      kind: 'month',
      match: (ts) => monthKey(ts) === key,
      prevKey: previousMonthKey(key),
    };
  }

  return parsePeriod(monthKey(now.getTime()), now);
}
