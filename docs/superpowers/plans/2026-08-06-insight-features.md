# Insight Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add period-over-period deltas, custom date ranges, cache economics and a savings-headroom counterfactual to the Cost Lens dashboard, using only data already in the ledger.

**Architecture:** The period selector's `month: string` is threaded through the entire delegate chain, so instead of changing signatures we widen the string vocabulary with a third form (`range:YYYY-MM-DD..YYYY-MM-DD`). A new `src/core/period.ts` owns key parsing and the local-time date helpers that `aggregate.ts` currently holds; `aggregate.ts` re-exports them so no existing import breaks. A new `src/core/insights.ts` holds two pure functions over already-aggregated summaries.

**Tech Stack:** TypeScript (strict), esbuild bundle, vitest, VS Code webview with inline JS.

## Global Constraints

- Minimum VS Code is `^1.75.0` — do not use an API newer than that.
- **No network calls, ever.** No new runtime dependencies.
- No prompt or message content is read, stored or displayed. Insights work from token counts and the price table only.
- All money formatting goes through the existing display-currency mechanism; receipts stay in USD.
- User-visible strings must be added to `src/ui/strings.ts` and to all three bundles: `l10n/bundle.l10n.cs.json`, `l10n/bundle.l10n.de.json`, `l10n/bundle.l10n.ja.json`. English is the source and lives in the code.
- Tests live in `test/*.test.ts` and run with `npm test` (vitest). Typecheck with `npx tsc --noEmit`.
- Dates are **local time** throughout. Never use `toISOString()` for a day key — it shifts by the UTC offset.

---

### Task 1: Period key parsing

Extracts the local-date helpers out of `aggregate.ts` into a new module and adds the `range:` key form. Behaviour-preserving for existing keys.

**Files:**
- Create: `src/core/period.ts`
- Modify: `src/core/aggregate.ts` (delete the moved helpers, import + re-export them)
- Test: `test/period.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type PeriodKind = 'month' | 'range' | 'all'`
  - `interface Period { key: string; kind: PeriodKind; match(timestamp: number): boolean; prevKey?: string }`
  - `function parsePeriod(key: string, now?: Date): Period`
  - `function rangeKey(fromIso: string, toIso: string): string`
  - `function isoDay(d: Date): string`
  - `function monthKey(timestamp: number): string`
  - `function dayKey(timestamp: number): string`
  - `function previousMonthKey(month: string): string`
  - `const ALL_TIME = 'all'`, `const RANGE_PREFIX = 'range:'`

- [ ] **Step 1: Write the failing test**

Create `test/period.test.ts`:

```ts
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
    for (const bad of ['', 'nonsense', 'range:', 'range:2026-08-06..2026-07-14', 'range:2026-13-01..2026-13-02']) {
      expect(parsePeriod(bad, now).key).toBe('2026-08');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/period.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/period"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/period.ts`:

```ts
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
    const [fromIso, toIso] = key.slice(RANGE_PREFIX.length).split('..');
    const from = parseDay(fromIso ?? '');
    const to = parseDay(toIso ?? '');
    if (from && to && from.getTime() <= to.getTime()) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/period.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Move the helpers out of aggregate.ts**

In `src/core/aggregate.ts`, delete these four now-duplicated declarations: `monthKey` (currently lines 17–21), `dayKey` (23–27), `ALL_TIME` (42–43) and `previousMonthKey` (186–190). Replace the top of the file's import block with:

```ts
import { creditsToUsd } from './pricing';
import { ALL_TIME, dayKey, monthKey, parsePeriod, previousMonthKey } from './period';
```

and immediately below the imports add the re-export so every existing consumer keeps working:

```ts
export { ALL_TIME, dayKey, monthKey, previousMonthKey };
export type { Period, PeriodKind } from './period';
```

Leave `currentMonthKey` and `availableMonths` in `aggregate.ts` — they are report concerns, not key parsing.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: 118 existing + 5 new tests pass, no type errors. `test/aggregate.test.ts` imports `monthKey`, `dayKey` and `ALL_TIME` from `aggregate` — the re-export is what keeps it green. If it fails to resolve, the re-export line is wrong.

- [ ] **Step 7: Commit**

```bash
git add src/core/period.ts src/core/aggregate.ts test/period.test.ts
git commit -m "feat: period key parsing with custom day ranges"
```

---

### Task 2: Filter reports by period

Makes `range:` keys actually select data. Behaviour for `YYYY-MM` and `all` is unchanged.

**Files:**
- Modify: `src/core/aggregate.ts` (`buildMonthReport`, lines 53–57 and 114–131)
- Test: `test/aggregate.test.ts` (append)

**Interfaces:**
- Consumes: `parsePeriod`, `Period`, `ALL_TIME` from Task 1.
- Produces: `ReportOptions.month` now accepts a `range:` key. `MonthReport.month` carries whatever key was requested.

- [ ] **Step 1: Write the failing test**

Append to `test/aggregate.test.ts` (the file's `event()` helper already exists at the top — reuse it):

```ts
describe('buildMonthReport with a custom range', () => {
  const now = new Date(2026, 5, 10);

  it('includes only events inside the inclusive range', () => {
    const events = [
      event({ timestamp: new Date(2026, 5, 3, 12).getTime(), credits: 5 }),
      event({ timestamp: new Date(2026, 5, 5, 12).getTime(), credits: 7 }),
      event({ timestamp: new Date(2026, 5, 9, 12).getTime(), credits: 11 }),
    ];
    const r = buildMonthReport(events, {
      month: 'range:2026-06-05..2026-06-09',
      includedCredits: 1900,
      now,
    });
    expect(r.totalCredits).toBe(18);
    expect(r.requestCount).toBe(2);
  });

  it('spans a month boundary', () => {
    const events = [
      event({ timestamp: new Date(2026, 4, 30, 12).getTime(), credits: 3 }),
      event({ timestamp: new Date(2026, 5, 2, 12).getTime(), credits: 4 }),
    ];
    const r = buildMonthReport(events, {
      month: 'range:2026-05-30..2026-06-02',
      includedCredits: 1900,
      now,
    });
    expect(r.totalCredits).toBe(7);
  });

  it('reports no allowance or forecast for a range', () => {
    const events = [event({ timestamp: new Date(2026, 5, 5, 12).getTime(), credits: 9 })];
    const r = buildMonthReport(events, {
      month: 'range:2026-06-01..2026-06-09',
      includedCredits: 1900,
      now,
    });
    expect(r.includedCredits).toBe(0);
    expect(r.usedPercent).toBe(0);
    expect(r.forecastCredits).toBe(9);
    expect(r.allowanceExhaustion).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aggregate.test.ts -t 'custom range'`
Expected: FAIL — the first test gets `totalCredits: 0`, because the current filter compares `monthKey(e.timestamp) === 'range:2026-06-05..2026-06-09'` and never matches.

- [ ] **Step 3: Write the implementation**

In `buildMonthReport`, replace the filter (currently lines 54–57):

```ts
  const period = parsePeriod(options.month, options.now ?? new Date());
  const inMonth = events.filter((e) => period.match(e.timestamp));
```

Replace the allowance line (currently line 117):

```ts
  // a monthly allowance is meaningless outside a calendar month
  const includedCredits = period.kind === 'month' ? options.includedCredits : 0;
```

Replace the previous-month block (currently lines 120–131):

```ts
  let prevMonth: string | undefined;
  let prevMonthUsd: number | undefined;
  if (period.kind === 'month' && period.prevKey) {
    prevMonth = period.prevKey;
    let prevCredits = 0;
    for (const e of events) {
      if (monthKey(e.timestamp) === prevMonth) {
        prevCredits += e.credits;
      }
    }
    prevMonthUsd = creditsToUsd(prevCredits);
  }
```

`forecast()` and `allowanceExhaustion()` need no change: both already bail out unless `month === currentMonthKey(now)`, and a `range:` key never equals a month key.

Also widen the doc comment on `ReportOptions.month` to:

```ts
  /** YYYY-MM, ALL_TIME, or a `range:` key — see parsePeriod(). */
  month: string;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass, including the three new range tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/aggregate.ts test/aggregate.test.ts
git commit -m "feat: filter reports by custom day range"
```

---

### Task 3: Period-over-period deltas

Adds a `compare` block to `MonthReport` carrying the previous window's total and per-repository spend.

**Files:**
- Modify: `src/types.ts` (add `CompareBlock`, add `compare?` to `MonthReport`)
- Modify: `src/core/aggregate.ts` (`buildMonthReport`)
- Test: `test/aggregate.test.ts` (append)

**Interfaces:**
- Consumes: `parsePeriod`, `Period.prevKey` from Task 1.
- Produces: `MonthReport.compare?: CompareBlock` where

  ```ts
  interface CompareBlock {
    key: string;
    usd: number;
    repos: Record<string, number>;
  }
  ```

  `repos` maps `RepoSummary.repo.name` to that repository's USD in the previous window. A repository absent from the map had no spend then, which the UI renders as "new" rather than +∞.

- [ ] **Step 1: Write the failing test**

Append to `test/aggregate.test.ts`:

```ts
describe('period-over-period comparison', () => {
  const now = new Date(2026, 5, 10);

  it('totals the previous calendar month and splits it per repository', () => {
    const events = [
      event({ timestamp: new Date(2026, 4, 5).getTime(), repo: { name: 'owner/alpha' }, credits: 100 }),
      event({ timestamp: new Date(2026, 4, 6).getTime(), repo: { name: 'owner/beta' }, credits: 50 }),
      event({ timestamp: new Date(2026, 5, 5).getTime(), repo: { name: 'owner/alpha' }, credits: 20 }),
    ];
    const r = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(r.compare?.key).toBe('2026-05');
    expect(r.compare?.usd).toBeCloseTo(1.5);
    expect(r.compare?.repos['owner/alpha']).toBeCloseTo(1.0);
    expect(r.compare?.repos['owner/beta']).toBeCloseTo(0.5);
  });

  it('omits repositories with no previous spend', () => {
    const events = [
      event({ timestamp: new Date(2026, 5, 5).getTime(), repo: { name: 'owner/fresh' }, credits: 20 }),
    ];
    const r = buildMonthReport(events, { month: '2026-06', includedCredits: 1900, now });
    expect(r.compare?.repos['owner/fresh']).toBeUndefined();
  });

  it('compares a range against the equal-length window before it', () => {
    const events = [
      event({ timestamp: new Date(2026, 5, 1).getTime(), credits: 40 }), // previous window
      event({ timestamp: new Date(2026, 5, 6).getTime(), credits: 10 }), // selected window
    ];
    const r = buildMonthReport(events, {
      month: 'range:2026-06-05..2026-06-09',
      includedCredits: 1900,
      now,
    });
    expect(r.compare?.key).toBe('range:2026-05-31..2026-06-04');
    expect(r.compare?.usd).toBeCloseTo(0.4);
  });

  it('has no comparison for all-time', () => {
    const events = [event({ credits: 10 })];
    const r = buildMonthReport(events, { month: ALL_TIME, includedCredits: 1900, now });
    expect(r.compare).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aggregate.test.ts -t 'period-over-period'`
Expected: FAIL — `r.compare` is `undefined`, and TypeScript reports `Property 'compare' does not exist on type 'MonthReport'`.

- [ ] **Step 3: Add the type**

In `src/types.ts`, add above `MonthReport`:

```ts
/** The window preceding the selected period, for delta rendering. */
export interface CompareBlock {
  /** Period key of the previous window. */
  key: string;
  /** Total spend of the previous window. */
  usd: number;
  /** Repository display name → USD in the previous window. Absent = no spend. */
  repos: Record<string, number>;
}
```

and add the field to `MonthReport`, next to the existing `prevMonth` / `prevMonthUsd`:

```ts
  /** Previous equal-length window; undefined for all-time. */
  compare?: CompareBlock;
```

Keep `prevMonth` / `prevMonthUsd` — the status bar and existing webview code read them.

- [ ] **Step 4: Write the implementation**

In `src/core/aggregate.ts`, add this function below `buildMonthReport`:

```ts
/** Total and per-repository spend of the window preceding `period`. */
function buildCompare(events: UsageEvent[], period: Period, now: Date): CompareBlock | undefined {
  if (!period.prevKey) {
    return undefined;
  }
  const prev = parsePeriod(period.prevKey, now);
  const repos: Record<string, number> = {};
  let credits = 0;
  for (const e of events) {
    if (!prev.match(e.timestamp)) {
      continue;
    }
    credits += e.credits;
    repos[e.repo.name] = (repos[e.repo.name] ?? 0) + e.credits;
  }
  for (const name of Object.keys(repos)) {
    repos[name] = creditsToUsd(repos[name]);
  }
  return { key: period.prevKey, usd: creditsToUsd(credits), repos };
}
```

Add `CompareBlock` and `Period` to the type imports at the top of the file:

```ts
import { CompareBlock, /* …existing… */ UsageEvent } from '../types';
import { ALL_TIME, dayKey, monthKey, parsePeriod, Period, previousMonthKey } from './period';
```

Then add the field to the object `buildMonthReport` returns, immediately after `prevMonthUsd`:

```ts
    compare: buildCompare(events, period, now),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/core/aggregate.ts test/aggregate.test.ts
git commit -m "feat: period-over-period comparison block"
```

---

### Task 4: Cache economics

Pure arithmetic over `ModelSummary` and the price table. No heuristic.

**Files:**
- Create: `src/core/insights.ts`
- Test: `test/insights.test.ts`

**Interfaces:**
- Consumes: `ModelSummary` from `src/types.ts`; `rateFor`, `PricingOptions` from `src/core/pricing.ts`.
- Produces:

  ```ts
  interface CacheEconomics { saved: number; paid: number; net: number }
  function cacheEconomics(models: ModelSummary[], options?: PricingOptions): CacheEconomics
  ```

  All figures in USD.

- [ ] **Step 1: Write the failing test**

Create `test/insights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cacheEconomics } from '../src/core/insights';
import { ModelSummary } from '../src/types';

function model(partial: Partial<ModelSummary>): ModelSummary {
  return {
    model: 'claude-sonnet-4.5',
    credits: 0,
    usd: 0,
    requestCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    ...partial,
  };
}

describe('cacheEconomics', () => {
  it('values cache reads at the gap between fresh and cached input', () => {
    // claude-sonnet-4.5: input 3.0, cachedInput 0.3 → gap 2.7 per 1M
    const r = cacheEconomics([model({ cachedTokens: 1_000_000 })]);
    expect(r.saved).toBeCloseTo(2.7);
    expect(r.paid).toBe(0);
    expect(r.net).toBeCloseTo(2.7);
  });

  it('charges cache writes at the model cacheWrite rate', () => {
    // claude-sonnet-4.5: cacheWrite 3.75 per 1M
    const r = cacheEconomics([model({ cacheWriteTokens: 1_000_000 })]);
    expect(r.paid).toBeCloseTo(3.75);
    expect(r.net).toBeCloseTo(-3.75);
  });

  it('charges nothing for cache writes on models that do not bill them', () => {
    const r = cacheEconomics([model({ model: 'gpt-5.4', cacheWriteTokens: 1_000_000 })]);
    expect(r.paid).toBe(0);
  });

  it('sums across models', () => {
    const r = cacheEconomics([
      model({ cachedTokens: 1_000_000 }),
      model({ model: 'gpt-5.4', cachedTokens: 1_000_000 }), // input 2.5, cached 0.25 → 2.25
    ]);
    expect(r.saved).toBeCloseTo(4.95);
  });

  it('returns zeroes for no models', () => {
    expect(cacheEconomics([])).toEqual({ saved: 0, paid: 0, net: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/insights.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/insights"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/insights.ts`:

```ts
import { PricingOptions, rateFor } from './pricing';
import { ModelSummary } from '../types';

const M = 1_000_000;

/** What prompt caching earned and cost over a period, in USD. */
export interface CacheEconomics {
  /** Value of cache reads: what those tokens would have cost as fresh input, minus what they did cost. */
  saved: number;
  /** What cache writes cost. Zero for models that do not bill cache creation. */
  paid: number;
  /** saved − paid. Legitimately negative for short sessions where the cache never gets reused. */
  net: number;
}

export function cacheEconomics(
  models: ModelSummary[],
  options: PricingOptions = {},
): CacheEconomics {
  let saved = 0;
  let paid = 0;
  for (const m of models) {
    const rate = rateFor(m.model, options);
    saved += (m.cachedTokens / M) * (rate.input - rate.cachedInput);
    paid += (m.cacheWriteTokens / M) * (rate.cacheWrite ?? 0);
  }
  return { saved, paid, net: saved - paid };
}
```

Note the deliberate difference from `priceTokensUsd`, which falls back to `tier.input` when `cacheWrite` is absent: here a missing `cacheWrite` rate means the vendor does not bill cache creation separately, so it contributes zero to `paid`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/insights.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/insights.ts test/insights.test.ts
git commit -m "feat: cache economics insight"
```

---

### Task 5: Savings headroom

A counterfactual: what the same token counts would have cost on the cheapest model of the same family. Explicitly not a recommendation.

**Files:**
- Modify: `src/core/insights.ts`
- Test: `test/insights.test.ts` (append)

**Interfaces:**
- Consumes: `cacheEconomics` module scaffolding from Task 4; `DEFAULT_RATES`, `normalizeModelId`, `priceTokensUsd`, `rateFor`, `PricingOptions` from `src/core/pricing.ts`.
- Produces:

  ```ts
  interface HeadroomRow { model: string; cheapest: string; actualUsd: number; counterfactualUsd: number }
  interface SavingsHeadroom { rows: HeadroomRow[]; actualUsd: number; counterfactualUsd: number }
  function savingsHeadroom(models: ModelSummary[], options?: PricingOptions): SavingsHeadroom
  ```

  `rows` is sorted by descending `actualUsd − counterfactualUsd` and omits models that are already the cheapest in their family.

- [ ] **Step 1: Write the failing test**

Append to `test/insights.test.ts` (extend the import at the top to `import { cacheEconomics, savingsHeadroom } from '../src/core/insights';`):

```ts
describe('savingsHeadroom', () => {
  it('reprices an expensive model at the cheapest of its family', () => {
    // 100k stays under gpt-5.5's 272k long-context threshold, so base rates apply.
    // gpt-5.5: input 5.0, output 30.0 → 0.1M in + 0.1M out = $3.50
    // cheapest of the gpt family is gpt-5.4-nano: input 0.2, output 1.25 → $0.145
    const r = savingsHeadroom([
      model({ model: 'gpt-5.5', inputTokens: 100_000, outputTokens: 100_000 }),
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].cheapest).toBe('gpt-5.4-nano');
    expect(r.rows[0].actualUsd).toBeCloseTo(3.5);
    expect(r.rows[0].counterfactualUsd).toBeCloseTo(0.145);
    expect(r.actualUsd).toBeCloseTo(3.5);
    expect(r.counterfactualUsd).toBeCloseTo(0.145);
  });

  it('omits a model that is already the cheapest in its family', () => {
    const r = savingsHeadroom([
      model({ model: 'gpt-5.4-nano', inputTokens: 100_000, outputTokens: 100_000 }),
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.actualUsd).toBeCloseTo(0.145);
    expect(r.counterfactualUsd).toBeCloseTo(0.145);
  });

  it('keeps families apart', () => {
    const r = savingsHeadroom([
      model({ model: 'claude-opus-4.8', inputTokens: M }),
    ]);
    expect(r.rows[0].cheapest).toBe('claude-haiku-4');
  });

  it('contributes no headroom for a model outside the price table', () => {
    const r = savingsHeadroom([model({ model: 'totally-unknown-model', inputTokens: M })]);
    expect(r.rows).toHaveLength(0);
    expect(r.actualUsd).toBeCloseTo(r.counterfactualUsd);
  });

  it('sorts rows by absolute headroom, largest first', () => {
    const r = savingsHeadroom([
      model({ model: 'claude-opus-4.8', inputTokens: M }),   // 5.0 → 1.0, headroom 4.0
      // 10M input crosses gpt-5.5's 272k threshold, so it bills at the 10.0 tier:
      // $100 actual; gpt-5.4-nano has no long-context tier → $2. Headroom 98.
      model({ model: 'gpt-5.5', inputTokens: 10 * M }),
    ]);
    expect(r.rows.map((x) => x.model)).toEqual(['gpt-5.5', 'claude-opus-4.8']);
  });
});
```

Add `const M = 1_000_000;` at the top of `test/insights.test.ts`, below the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/insights.test.ts -t savingsHeadroom`
Expected: FAIL — `savingsHeadroom is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/insights.ts`, and extend its pricing import to
`import { DEFAULT_RATES, normalizeModelId, priceTokensUsd, PricingOptions, rateFor } from './pricing';`:

```ts
/** One model's actual spend next to what the cheapest of its family would have cost. */
export interface HeadroomRow {
  model: string;
  /** Price-table id of the cheapest model in the same family. */
  cheapest: string;
  actualUsd: number;
  counterfactualUsd: number;
}

/**
 * A ceiling on what could have been saved — NOT a recommendation. Some of that
 * traffic needed the expensive model, and we have no way to tell which: the
 * extension never reads prompt content.
 */
export interface SavingsHeadroom {
  rows: HeadroomRow[];
  actualUsd: number;
  counterfactualUsd: number;
}

/**
 * Family of a price-table id: the vendor-line prefix before the first hyphen.
 * `gpt-5.5` → `gpt`, `claude-opus-4.8` → `claude`, `gemini-3-flash` → `gemini`.
 */
function familyOf(id: string): string {
  return id.split('-')[0];
}

/** Blended rate used only to rank models within a family. */
function blended(model: string): number {
  const rate = DEFAULT_RATES[model];
  return (rate.input + rate.output) / 2;
}

/** Cheapest price-table id sharing a family with `id`, or undefined when unknown. */
function cheapestInFamily(id: string): string | undefined {
  if (!DEFAULT_RATES[id]) {
    return undefined;
  }
  const family = familyOf(id);
  let best: string | undefined;
  for (const candidate of Object.keys(DEFAULT_RATES)) {
    if (familyOf(candidate) !== family) {
      continue;
    }
    if (!best || blended(candidate) < blended(best)) {
      best = candidate;
    }
  }
  return best;
}

export function savingsHeadroom(
  models: ModelSummary[],
  options: PricingOptions = {},
): SavingsHeadroom {
  const rows: HeadroomRow[] = [];
  let actualUsd = 0;
  let counterfactualUsd = 0;

  for (const m of models) {
    const id = normalizeModelId(m.model);
    const actual = priceTokensUsd(m, rateFor(m.model, options));
    actualUsd += actual;

    const cheapest = cheapestInFamily(id);
    if (!cheapest || cheapest === id) {
      // unknown family, or already the cheapest — no headroom either way
      counterfactualUsd += actual;
      continue;
    }
    // Long-context tiers are ignored on purpose: the cheap model may not even
    // have the context window, so its base rate is the honest lower bound.
    const counterfactual = priceTokensUsd(m, DEFAULT_RATES[cheapest]);
    counterfactualUsd += counterfactual;
    rows.push({ model: m.model, cheapest, actualUsd: actual, counterfactualUsd: counterfactual });
  }

  rows.sort((a, b) => b.actualUsd - b.counterfactualUsd - (a.actualUsd - a.counterfactualUsd));
  return { rows, actualUsd, counterfactualUsd };
}
```

The family rule was verified against the current `DEFAULT_RATES`: `gpt-5.5` → family `gpt` → cheapest `gpt-5.4-nano`; `claude-opus-4.8` → family `claude` → cheapest `claude-haiku-4`; `gemini-3-flash` is already the cheapest `gemini` and therefore produces no row. Ties (`claude-haiku-4` and `claude-haiku-4.5` blend identically) resolve to whichever key comes first in `DEFAULT_RATES`, because the comparison is strict `<`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/insights.ts test/insights.test.ts
git commit -m "feat: savings headroom counterfactual"
```

---

### Task 6: Custom range picker in the dashboard

**Files:**
- Modify: `src/ui/dashboardHtml.ts` (the `<select id="month">` at line 138, the option builder at lines 216–219, and the `changeMonth` message handler)
- Modify: `src/ui/dashboard.ts` (`IncomingMessage`, `currentMonth()` at lines 183–187)
- Modify: `src/ui/strings.ts`
- Modify: `l10n/bundle.l10n.cs.json`, `l10n/bundle.l10n.de.json`, `l10n/bundle.l10n.ja.json`
- Test: `test/ui.test.ts` (append)

**Interfaces:**
- Consumes: `parsePeriod`, `rangeKey`, `RANGE_PREFIX` from Task 1.
- Produces: the webview can post `{ type: 'changeMonth', month: 'range:…' }`.

- [ ] **Step 1: Add the strings**

In `src/ui/strings.ts` add three entries to the returned object, following the existing `vscode.l10n.t(...)` pattern used by its neighbours:

```ts
    customRange: vscode.l10n.t('Custom range…'),
    rangeFrom: vscode.l10n.t('From'),
    rangeTo: vscode.l10n.t('To'),
```

Add the matching keys to all three bundles:

- `l10n/bundle.l10n.cs.json`: `"Custom range…": "Vlastní rozsah…"`, `"From": "Od"`, `"To": "Do"`
- `l10n/bundle.l10n.de.json`: `"Custom range…": "Eigener Zeitraum…"`, `"From": "Von"`, `"To": "Bis"`
- `l10n/bundle.l10n.ja.json`: `"Custom range…": "カスタム期間…"`, `"From": "開始"`, `"To": "終了"`

- [ ] **Step 2: Write the failing test**

Append to `test/ui.test.ts`:

```ts
describe('period selector', () => {
  it('renders the custom-range option and inputs', () => {
    const html = renderDashboardHtml({ customRange: 'Custom range…', rangeFrom: 'From', rangeTo: 'To' });
    expect(html).toContain('id="rangeFrom"');
    expect(html).toContain('id="rangeTo"');
    expect(html).toContain('Custom range…');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ui.test.ts -t 'period selector'`
Expected: FAIL — `id="rangeFrom"` is not in the output.

- [ ] **Step 4: Implement the markup**

In `src/ui/dashboardHtml.ts`, replace the selector at line 138 with:

```html
    <select id="month"></select>
    <span id="rangeBox" hidden>
      <label for="rangeFrom">${strings.rangeFrom}</label>
      <input type="date" id="rangeFrom">
      <label for="rangeTo">${strings.rangeTo}</label>
      <input type="date" id="rangeTo">
    </span>
```

`<input type="date">` is native to the webview's Chromium — no date-picker library.

- [ ] **Step 5: Implement the behaviour**

In the inline webview script, extend the option builder (currently lines 217–219) with a trailing custom entry:

```js
    const isRange = String(selectedMonth).startsWith('range:');
    document.getElementById('month').innerHTML =
      '<option value="all"' + (selectedMonth === 'all' ? ' selected' : '') + '>' + esc(S.allTime) + '</option>' +
      months.map((m) => '<option value="' + m + '"' + (m === selectedMonth ? ' selected' : '') + '>' + m + '</option>').join('') +
      '<option value="custom"' + (isRange ? ' selected' : '') + '>' + esc(S.customRange) + '</option>';

    const box = document.getElementById('rangeBox');
    box.hidden = !isRange;
    if (isRange) {
      const [from, to] = selectedMonth.slice('range:'.length).split('..');
      document.getElementById('rangeFrom').value = from || '';
      document.getElementById('rangeTo').value = to || '';
    }
```

In the `month` select's `change` handler, branch on the sentinel:

```js
    if (this.value === 'custom') {
      document.getElementById('rangeBox').hidden = false;
      return; // wait for both dates before asking for a report
    }
    vscode.postMessage({ type: 'changeMonth', month: this.value });
```

Add a shared handler on both date inputs:

```js
  function submitRange() {
    const from = document.getElementById('rangeFrom').value;
    const to = document.getElementById('rangeTo').value;
    if (from && to && from <= to) {
      vscode.postMessage({ type: 'changeMonth', month: 'range:' + from + '..' + to });
    }
  }
  document.getElementById('rangeFrom').addEventListener('change', submitRange);
  document.getElementById('rangeTo').addEventListener('change', submitRange);
```

- [ ] **Step 6: Accept range keys in the controller**

In `src/ui/dashboard.ts`, `currentMonth()` currently accepts `'all'` or a member of `getMonths()`. Widen it:

```ts
    const months = this.delegate.getMonths();
    if (
      this.selectedMonth === 'all' ||
      this.selectedMonth?.startsWith('range:') ||
      (this.selectedMonth && months.includes(this.selectedMonth))
    ) {
      return this.selectedMonth;
    }
    return months[0] ?? 'all';
```

A malformed range key still cannot break anything: `parsePeriod` falls back to the current month.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 8: Manual check**

Run: `npm run build`, then press F5 in VS Code to launch the Extension Development Host. Open the Cost Lens dashboard, pick *Custom range…*, choose two dates, confirm the numbers change and the receipt/CSV export buttons use the same window.

- [ ] **Step 9: Commit**

```bash
git add src/ui/dashboardHtml.ts src/ui/dashboard.ts src/ui/strings.ts l10n test/ui.test.ts
git commit -m "feat: custom date range in the period selector"
```

---

### Task 7: Delta arrows

**Files:**
- Modify: `src/ui/dashboardHtml.ts` (`kpiSpend` at line 591, and the repository table row builder)
- Modify: `src/ui/strings.ts`
- Modify: the three `l10n/bundle.l10n.*.json`
- Test: `test/ui.test.ts` (append)

**Interfaces:**
- Consumes: `MonthReport.compare` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the strings**

`src/ui/strings.ts`:

```ts
    vsPrevious: vscode.l10n.t('vs previous'),
    newThisPeriod: vscode.l10n.t('new'),
```

Bundles — cs: `"vs previous": "oproti minulému"`, `"new": "nové"`; de: `"vs previous": "ggü. Vorperiode"`, `"new": "neu"`; ja: `"vs previous": "前期比"`, `"new": "新規"`.

- [ ] **Step 2: Write the failing test**

Append to `test/ui.test.ts`:

```ts
describe('delta rendering', () => {
  it('exposes a delta helper that formats sign and percent', () => {
    const html = renderDashboardHtml({ vsPrevious: 'vs previous', newThisPeriod: 'new' });
    expect(html).toContain('function deltaBadge');
    expect(html).toContain('vs previous');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ui.test.ts -t 'delta rendering'`
Expected: FAIL — `function deltaBadge` is not in the output.

- [ ] **Step 4: Implement the helper**

Add to the inline webview script, next to the other formatting helpers:

```js
  // current vs previous USD → "▲ 24% vs previous", "▼ 8% vs previous", or "new"
  function deltaBadge(current, previous) {
    if (previous === undefined) return '<span class="delta new">' + esc(S.newThisPeriod) + '</span>';
    if (previous === 0) return '';
    const pct = ((current - previous) / previous) * 100;
    if (Math.abs(pct) < 1) return '';
    const up = pct > 0;
    return '<span class="delta ' + (up ? 'up' : 'down') + '">' +
      (up ? '▲' : '▼') + ' ' + Math.abs(Math.round(pct)) + '% ' + esc(S.vsPrevious) + '</span>';
  }
```

Deltas below 1% are suppressed — a rounding wobble is not news.

- [ ] **Step 5: Wire it into the spend card**

`kpiSpend` (line 591) already renders a previous-month comparison from `r.prevMonthUsd`. Replace that branch so it reads the new block and works for ranges too:

```js
    const cmp = r.compare;
    const delta = cmp ? deltaBadge(r.totalUsd, cmp.usd) : '';
```

and interpolate `delta` where the old comparison string was.

- [ ] **Step 6: Wire it into the repository table**

In the repository row builder, add a cell after the USD cell:

```js
      '<td class="num">' + (r.compare ? deltaBadge(repo.usd, r.compare.repos[repo.repo.name]) : '') + '</td>' +
```

Add a matching `<th></th>` to the table header so column counts stay aligned.

- [ ] **Step 7: Add the styles**

In the stylesheet block:

```css
    .delta { font-size: 0.85em; margin-left: 0.4em; }
    .delta.up { color: var(--vscode-charts-red); }
    .delta.down { color: var(--vscode-charts-green); }
    .delta.new { color: var(--vscode-descriptionForeground); }
```

Up is red and down is green: this is spend, not revenue.

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/ui/dashboardHtml.ts src/ui/strings.ts l10n test/ui.test.ts
git commit -m "feat: period-over-period delta badges"
```

---

### Task 8: Insight cards, changelog and release

**Files:**
- Modify: `src/types.ts` (add `insights?` to `MonthReport`)
- Modify: `src/core/aggregate.ts` (populate it)
- Modify: `src/ui/dashboardHtml.ts` (two cards)
- Modify: `src/ui/strings.ts`, the three `l10n/bundle.l10n.*.json`
- Modify: `CHANGELOG.md`, `package.json`, `README.md`
- Test: `test/aggregate.test.ts` (append)

**Interfaces:**
- Consumes: `cacheEconomics`, `savingsHeadroom` from Tasks 4–5.
- Produces: `MonthReport.insights?: { cache: CacheEconomics; headroom: SavingsHeadroom }`.

- [ ] **Step 1: Write the failing test**

Append to `test/aggregate.test.ts`:

```ts
describe('report insights', () => {
  it('attaches cache economics and savings headroom', () => {
    const events = [
      event({
        model: 'claude-sonnet-4.5',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 1_000_000,
        cacheWriteTokens: 0,
        timestamp: new Date(2026, 5, 5).getTime(),
      }),
    ];
    const r = buildMonthReport(events, {
      month: '2026-06',
      includedCredits: 1900,
      now: new Date(2026, 5, 10),
    });
    expect(r.insights?.cache.saved).toBeCloseTo(2.7);
    expect(r.insights?.headroom.rows[0].cheapest).toBe('claude-haiku-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aggregate.test.ts -t 'report insights'`
Expected: FAIL — `Property 'insights' does not exist on type 'MonthReport'`.

- [ ] **Step 3: Add the type and populate it**

In `src/types.ts`, import nothing new — instead declare the shape structurally to keep `types.ts` free of `core/` imports:

```ts
/** Derived insight blocks; see src/core/insights.ts. */
export interface ReportInsights {
  cache: { saved: number; paid: number; net: number };
  headroom: {
    rows: { model: string; cheapest: string; actualUsd: number; counterfactualUsd: number }[];
    actualUsd: number;
    counterfactualUsd: number;
  };
}
```

and add to `MonthReport`:

```ts
  /** Cache economics and savings headroom for the period. */
  insights?: ReportInsights;
```

In `buildMonthReport`, add to the returned object after `compare`:

```ts
    insights: { cache: cacheEconomics(models), headroom: savingsHeadroom(models) },
```

with `import { cacheEconomics, savingsHeadroom } from './insights';` at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/aggregate.test.ts -t 'report insights'`
Expected: PASS.

- [ ] **Step 5: Add the strings**

`src/ui/strings.ts`:

```ts
    cacheEconomics: vscode.l10n.t('Cache economics'),
    cacheSaved: vscode.l10n.t('Saved on cache reads'),
    cachePaid: vscode.l10n.t('Paid for cache writes'),
    cacheNet: vscode.l10n.t('Net'),
    savingsHeadroom: vscode.l10n.t('Savings headroom'),
    headroomCaveat: vscode.l10n.t('A ceiling, not a target — some of this traffic needed the expensive model.'),
    headroomWouldCost: vscode.l10n.t('would cost'),
```

Translate all seven into the three bundles.

- [ ] **Step 6: Render the cards**

In `renderOverview`, after the existing KPI cards, append two cards built from `r.insights`. Guard on `r.insights && r.insights.cache.saved + r.insights.cache.paid > 0` for the cache card and on `r.insights.headroom.rows.length` for the headroom card — an empty card is worse than no card.

The headroom card lists each row as `model → cheapest`, `usd(actualUsd)`, `usd(counterfactualUsd)` and the percentage drop, followed by `S.headroomCaveat` in the muted description style. The caveat is not optional and must not be collapsed behind a tooltip.

- [ ] **Step 7: Run tests, typecheck and build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.

- [ ] **Step 8: Manual check**

Press F5, open the dashboard on a month with real Anthropic traffic, confirm both cards render, that the net cache figure can go negative, and that the caveat is visible without hovering.

- [ ] **Step 9: Update the docs and version**

- `package.json`: bump `version` to `1.23.0`.
- `CHANGELOG.md`: add a `## [1.23.0] — <today>` section with an `### Added` list covering custom date ranges, period-over-period deltas, cache economics and savings headroom.
- `README.md`: add bullets for the four features to the *Features* list, matching the existing bold-lead-in style.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: v1.23.0 — cache economics and savings headroom"
```

---

## Notes for the implementer

- The webview JS lives inside a template string in `dashboardHtml.ts` and is not typechecked. Keep changes small and verify them in the Extension Development Host, not only through the string-matching tests.
- `test/ui.test.ts` calls `renderDashboardHtml(strings)` with a partial strings object. That is fine — missing keys render as `undefined` and the tests only assert on what they pass in.
- Nothing in this plan reads prompt content, opens a socket or adds a dependency. If a task seems to need any of those, stop and re-read the spec.
