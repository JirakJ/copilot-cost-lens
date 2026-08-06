# Insight features — design

**Date:** 2026-08-06
**Status:** approved, not yet implemented

Four additions that answer questions the current dashboard cannot, all built from data
already in the ledger. No new sources, no network, no prompt content.

## Motivation

Cost Lens answers *"what did I spend?"*. It does not answer:

- *"Is it growing?"* — there is one previous-month number and nothing per repository.
- *"What did this sprint cost?"* — periods are whole calendar months or all time.
- *"Is caching paying for itself?"* — cache read/write tokens are collected but only ever
  shown as raw counts.
- *"How much cheaper could this have been?"* — nothing.

## Period keys

`month: string` is threaded through the whole delegate chain (`getReport`, `getRepoDetail`,
`getGroupDetail`, `exportData`, `exportReceipt`). Rather than change those signatures, the
string vocabulary grows one entry:

```
"2026-08"                        calendar month   (existing)
"all"                            everything       (existing)
"range:2026-07-14..2026-08-06"   custom range     (new)
```

New module `src/core/period.ts`:

```ts
export interface Period {
  key: string;
  match(timestamp: number): boolean;
  label: string;
  /** Preceding window of equal length, for deltas. Undefined for "all". */
  prevKey?: string;
}
export function parsePeriod(key: string, now?: Date): Period;
```

Range bounds are inclusive whole local days. An unparseable or inverted range falls back to
the current month — the dashboard must never render an error state because of a bad key.

Because every consumer already passes the period key around, custom ranges reach CSV/JSON
exports and PDF receipts with no extra work.

### Migration

Existing keys keep their exact meaning. `ALL_TIME` stays exported. `buildMonthReport` swaps
its `monthKey(e.timestamp) === options.month` filter for `period.match(e.timestamp)`.

## Period-over-period deltas

`MonthReport` already carries `prevMonth` / `prevMonthUsd`. Generalise:

```ts
compare?: {
  label: string;              // e.g. "July 2026" or "previous 24 days"
  usd: number;                // previous-window total
  repos: Record<string, number>;  // repo name -> previous-window USD
}
```

Computed by running the same repo aggregation over the previous window. The dashboard
renders an arrow plus percentage on the total and on each repository row.

**Deliberately excluded: per-model deltas.** Model availability churns every month, so a
model delta is mostly noise about what the vendor shipped, not about spending behaviour.

New repositories (no previous-window spend) render as "new", not as +∞.

## Cache economics

Pure arithmetic over existing fields and the existing price table — no heuristic:

```
saved = cachedTokens     × (rate.input − rate.cachedInput) / 1e6
paid  = cacheWriteTokens × (rate.cacheWrite ?? 0)          / 1e6
net   = saved − paid
```

Shown as a dashboard card (total saved / paid / net) and a per-repository column. Models
without a `cacheWrite` rate contribute `paid = 0`, which is correct — only Anthropic models
bill cache writes.

`net` can legitimately be negative for short sessions where the cache never gets reused;
that is the finding, not a bug.

## Savings headroom

A counterfactual, explicitly **not** a recommendation.

For each model with spend in the period, find the cheapest model in the same family and
recompute the period's token counts at that model's rates. Report actual vs. counterfactual
per model and in total.

- **Family** = prefix of the normalized model id (`gpt-5.*`, `claude-*`, `gemini-*`, …).
- **Cheapest** = lowest blended rate among that family's entries in `DEFAULT_RATES`,
  blended as `(input + output) / 2`.
- A model that is already the cheapest in its family contributes zero headroom.
- Long-context tiers are ignored in the counterfactual; the cheap model may not even have
  the context window. This is stated in the UI.

The card carries a permanent caveat: *this is a ceiling, not a target — some of that traffic
needed the expensive model*. We have no prompt content and will not acquire any, so the
extension must never claim a specific request was wasteful.

New module `src/core/insights.ts` holds `cacheEconomics()` and `savingsHeadroom()` as pure
functions over `ModelSummary[]` / `RepoSummary[]`.

## Files touched

| File | Change |
|---|---|
| `src/core/period.ts` | new — period key parsing |
| `src/core/insights.ts` | new — cache economics, savings headroom |
| `src/core/aggregate.ts` | period predicate instead of month equality; `compare` block |
| `src/types.ts` | `compare` on `MonthReport`; insight result types |
| `src/ui/dashboard.ts` | pass range selection through |
| `src/ui/dashboardHtml.ts` | range picker, delta arrows, two new cards |
| `l10n/*` | strings for en / cs / de / ja |

## Testing

`period.ts` and `insights.ts` are pure and get direct unit tests (vitest, already in the
repo). Cases that must be covered:

- period parsing: valid range, inverted range, malformed string, `all`, calendar month
- previous-window derivation for a range that spans a month boundary
- deltas: repository present in both windows, only current, only previous
- cache economics: model with no `cacheWrite` rate; negative net
- savings headroom: model already cheapest in family; unknown family falls through to zero

## Out of scope

Additional sources (Gemini CLI, Cursor, Windsurf), branch/PR attribution, and multi-machine
merge were considered and deferred. Each is its own spec.
