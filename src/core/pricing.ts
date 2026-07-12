import { CostSource, ModelRate, RawUsage } from '../types';

/** 1 AI Credit = $0.01 (GitHub's dollar-normalized unit). */
export const USD_PER_CREDIT = 0.01;

/** Overage price of one premium request (pre-June-2026 Copilot billing). */
export const USD_PER_PREMIUM_REQUEST = 0.04;

/**
 * Built-in price table, USD per 1M tokens.
 * Source: GitHub Copilot "Models and pricing" reference (checked 2026-06-11):
 * https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * Keys are normalized model ids — see normalizeModelId().
 */
export const DEFAULT_RATES: Record<string, ModelRate> = {
  // legacy ids kept for historical data
  'gpt-4.1': { input: 2.0, cachedInput: 0.5, output: 8.0 },
  'gpt-5': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  // current official table
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
  'gpt-5.4': {
    input: 2.5, cachedInput: 0.25, output: 15.0,
    longContext: { threshold: 272_000, input: 5.0, cachedInput: 0.5, output: 22.5 },
  },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5.5': {
    input: 5.0, cachedInput: 0.5, output: 30.0,
    longContext: { threshold: 272_000, input: 10.0, cachedInput: 1.0, output: 45.0 },
  },
  'gpt-5.6-sol': { input: 5.0, cachedInput: 0.5, output: 30.0 },
  'gpt-5.6-terra': { input: 2.5, cachedInput: 0.25, output: 15.0 },
  'gpt-5.6-luna': { input: 1.0, cachedInput: 0.1, output: 6.0 },
  'claude-haiku-4': { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
  'claude-haiku-4.5': { input: 1.0, cachedInput: 0.1, cacheWrite: 1.25, output: 5.0 },
  'claude-sonnet-4': { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  'claude-sonnet-4.5': { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  'claude-sonnet-4.6': { input: 3.0, cachedInput: 0.3, cacheWrite: 3.75, output: 15.0 },
  // 'claude-opus-4' also acts as a prefix catch-all for future 4.x releases
  'claude-opus-4': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4.5': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4.6': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4.7': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-opus-4.8': { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 25.0 },
  'claude-fable-5': { input: 10.0, cachedInput: 1.0, cacheWrite: 12.5, output: 50.0 },
  'gemini-2.5-pro': { input: 1.25, cachedInput: 0.125, output: 10.0 },
  'gemini-3-pro': { input: 2.0, cachedInput: 0.2, output: 12.0 },
  'gemini-3-flash': { input: 0.5, cachedInput: 0.05, output: 3.0 },
  'gemini-3.1-pro': {
    input: 2.0, cachedInput: 0.2, output: 12.0,
    longContext: { threshold: 200_000, input: 4.0, cachedInput: 0.4, output: 18.0 },
  },
  'gemini-3.5-flash': { input: 1.5, cachedInput: 0.15, output: 9.0 },
  'grok-code-fast-1': { input: 0.2, cachedInput: 0.02, output: 1.5 },
  'raptor-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'mai-code-1-flash': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  goldeneye: { input: 1.25, cachedInput: 0.125, output: 10.0 },
};

/** Fallback for models missing from the table ("versatile"-tier rate). */
export const FALLBACK_RATE: ModelRate = { input: 2.0, cachedInput: 0.2, output: 10.0 };

/** Included monthly AI Credits per user, by plan. */
export const PLAN_CREDITS: Record<string, number> = {
  business: 1900,
  businessPromo: 3000,
  enterprise: 3900,
  enterprisePromo: 7000,
};

/**
 * Normalize raw model ids from logs to price-table keys.
 * Handles prefixes ("copilot/gpt-5-codex"), version suffixes and
 * vendor naming variations ("claude-sonnet-4.5-20260101").
 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase();
  const slash = id.lastIndexOf('/');
  if (slash >= 0) {
    id = id.slice(slash + 1);
  }
  id = id.replace(/\s+/g, '-');
  // strip trailing date-like or build suffixes: claude-opus-4.6-20260203 → claude-opus-4.6
  id = id.replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|preview|latest)$/i, '');
  // Anthropic API ids use dashed versions: claude-opus-4-5 → claude-opus-4.5
  id = id.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  return id;
}

export interface PricingOptions {
  overrides?: Record<string, Partial<ModelRate>>;
  fallbackRate?: ModelRate;
}

export function rateFor(model: string, options: PricingOptions = {}): ModelRate {
  const id = normalizeModelId(model);
  const base = DEFAULT_RATES[id] ?? bestPrefixMatch(id) ?? options.fallbackRate ?? FALLBACK_RATE;
  const override = options.overrides?.[id];
  return override ? { ...base, ...override } : base;
}

/** "gpt-5.3-codex-experimental" still matches "gpt-5.3-codex". */
function bestPrefixMatch(id: string): ModelRate | undefined {
  let best: { key: string; rate: ModelRate } | undefined;
  for (const [key, rate] of Object.entries(DEFAULT_RATES)) {
    if (id.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, rate };
    }
  }
  return best?.rate;
}

/**
 * Price exact or estimated token counts, in USD.
 *
 * Token buckets are **disjoint** by convention (normalized at each source):
 * `inputTokens` is fresh (non-cached) input, `cachedTokens` is cache reads,
 * `cacheWriteTokens` is cache creation, `outputTokens` is generation. Each is
 * billed at its own rate; nothing is subtracted here.
 */
export function priceTokensUsd(
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens?: number },
  rate: ModelRate,
): number {
  const M = 1_000_000;
  const freshInput = Math.max(0, usage.inputTokens);
  const cached = Math.max(0, usage.cachedTokens);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const output = Math.max(0, usage.outputTokens);

  // long-context tier: the whole request bills at the higher rate once the
  // context (fresh input + cache reads) crosses the model's threshold
  const context = freshInput + cached;
  const tier =
    rate.longContext && context > rate.longContext.threshold
      ? { ...rate, ...rate.longContext }
      : rate;

  return (
    (freshInput / M) * tier.input +
    (cached / M) * tier.cachedInput +
    (cacheWrite / M) * (tier.cacheWrite ?? tier.input) +
    (output / M) * tier.output
  );
}

export interface PricedUsage {
  credits: number;
  costSource: CostSource;
}

/**
 * Resolve the cost of one raw usage record.
 * Order of authority: billed nano-credits → billed premium requests →
 * exact tokens → estimate.
 */
export function priceUsage(raw: RawUsage, options: PricingOptions = {}): PricedUsage {
  if (raw.nanoCredits !== undefined && raw.nanoCredits > 0) {
    return { credits: raw.nanoCredits / 1_000_000_000, costSource: 'billed' };
  }
  if (raw.premiumRequests !== undefined && raw.premiumRequests > 0) {
    return {
      credits: (raw.premiumRequests * USD_PER_PREMIUM_REQUEST) / USD_PER_CREDIT,
      costSource: 'billed',
    };
  }
  const usd = priceTokensUsd(raw, rateFor(raw.model, options));
  return { credits: usd / USD_PER_CREDIT, costSource: raw.estimated ? 'estimated' : 'computed' };
}

export function creditsToUsd(credits: number): number {
  return credits * USD_PER_CREDIT;
}
