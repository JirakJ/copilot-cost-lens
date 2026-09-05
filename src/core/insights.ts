import {
  DEFAULT_RATES,
  normalizeModelId,
  priceTokensUsd,
  PricingOptions,
  rateFor,
} from './pricing';
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
    // a missing cacheWrite rate means the vendor does not bill cache creation
    // separately — unlike priceTokensUsd, nothing falls back to the input rate
    paid += (m.cacheWriteTokens / M) * (rate.cacheWrite ?? 0);
  }
  return { saved, paid, net: saved - paid };
}

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
 * extension does not analyze prompt content for model suitability.
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
  return id.split('-')[0] ?? id;
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
    // These are period totals, not a single long-context request.
    const actual = m.usd;
    actualUsd += actual;

    let cheapest = id;
    let counterfactual = actual;
    if (Object.hasOwn(DEFAULT_RATES, id)) {
      for (const candidate of Object.keys(DEFAULT_RATES)) {
        if (familyOf(candidate) !== familyOf(id) || candidate === id) continue;
        // Aggregated tokens cannot establish a per-request context tier.
        const rate = { ...rateFor(candidate, options), longContext: undefined };
        const cost = priceTokensUsd(m, rate);
        if (cost < counterfactual) {
          cheapest = candidate;
          counterfactual = cost;
        }
      }
    }
    if (cheapest === id) {
      counterfactualUsd += actual;
      continue;
    }
    counterfactualUsd += counterfactual;
    rows.push({ model: m.model, cheapest, actualUsd: actual, counterfactualUsd: counterfactual });
  }

  rows.sort((a, b) => b.actualUsd - b.counterfactualUsd - (a.actualUsd - a.counterfactualUsd));
  return { rows, actualUsd, counterfactualUsd };
}
