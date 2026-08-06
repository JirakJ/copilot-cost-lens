import { describe, expect, it } from 'vitest';
import { ALL_TIME, parsePeriod, rangeKey } from '../src/core/period';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('parsePeriod', () => {
  it('matches everything for all-time and offers no previous window', () => {
    const p = parsePeriod(ALL_TIME);
    expect(p.kind).toBe('all');
    expect(p.match(at(2020, 1, 1))).toBe(true);
    expect(p.prevKey).toBeUndefined();
  });

  it('matches a calendar month and points at the previous one', () => {
    const p = parsePeriod('2026-06');
    expect(p.kind).toBe('month');
    expect(p.match(at(2026, 6, 30, 23))).toBe(true);
    expect(p.match(at(2026, 7, 1, 0))).toBe(false);
    expect(p.prevKey).toBe('2026-05');
  });

  it('matches an inclusive day range', () => {
    const p = parsePeriod(rangeKey('2026-07-14', '2026-08-06'));
    expect(p.kind).toBe('range');
    expect(p.match(at(2026, 7, 13, 23))).toBe(false);
    expect(p.match(at(2026, 7, 14, 0))).toBe(true);
    expect(p.match(at(2026, 8, 6, 23))).toBe(true);
    expect(p.match(at(2026, 8, 7, 0))).toBe(false);
  });

  it('derives an equal-length previous window ending the day before', () => {
    // 2026-07-14..2026-08-06 is 24 days → previous is 2026-06-20..2026-07-13
    const p = parsePeriod(rangeKey('2026-07-14', '2026-08-06'));
    expect(p.prevKey).toBe(rangeKey('2026-06-20', '2026-07-13'));
  });

  it('falls back to the current month for malformed or inverted keys', () => {
    const now = new Date(2026, 7, 6); // August 2026
    for (const bad of [
      '',
      'nonsense',
      'range:',
      'range:2026-08-06..2026-07-14',
      'range:2026-13-01..2026-13-02',
    ]) {
      expect(parsePeriod(bad, now).key).toBe('2026-08');
    }
  });
});
