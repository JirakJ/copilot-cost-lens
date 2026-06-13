import { describe, expect, it } from 'vitest';
import {
  creditsToUsd,
  DEFAULT_RATES,
  FALLBACK_RATE,
  normalizeModelId,
  priceTokensUsd,
  priceUsage,
  rateFor,
} from '../src/core/pricing';
import { RawUsage } from '../src/types';

function raw(partial: Partial<RawUsage>): RawUsage {
  return {
    sessionId: 's1',
    provider: 'copilot',
    workspaceStorageDir: '/tmp/ws',
    timestamp: Date.now(),
    model: 'gpt-5.5',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    ...partial,
  };
}

describe('normalizeModelId', () => {
  it('strips provider prefixes', () => {
    expect(normalizeModelId('copilot/gpt-5-codex')).toBe('gpt-5-codex');
  });

  it('lowercases and collapses spaces', () => {
    expect(normalizeModelId('Claude Sonnet 4.6')).toBe('claude-sonnet-4.6');
  });

  it('strips date suffixes', () => {
    expect(normalizeModelId('claude-opus-4.6-20260203')).toBe('claude-opus-4.6');
  });

  it('converts Anthropic dashed versions to dotted', () => {
    expect(normalizeModelId('claude-opus-4-5-20251101')).toBe('claude-opus-4.5');
    expect(normalizeModelId('claude-haiku-4-5')).toBe('claude-haiku-4.5');
    // non-numeric suffixes stay untouched
    expect(normalizeModelId('gpt-5-mini')).toBe('gpt-5-mini');
    expect(normalizeModelId('claude-fable-5')).toBe('claude-fable-5');
  });
});

describe('rateFor', () => {
  it('finds exact rates', () => {
    expect(rateFor('gpt-5.5')).toEqual(DEFAULT_RATES['gpt-5.5']);
  });

  it('matches by longest prefix', () => {
    expect(rateFor('gpt-5.3-codex-experimental')).toEqual(DEFAULT_RATES['gpt-5.3-codex']);
  });

  it('falls back for unknown models', () => {
    expect(rateFor('mystery-model-9000')).toEqual(FALLBACK_RATE);
  });

  it('applies user overrides on top of base rates', () => {
    const rate = rateFor('gpt-5.5', { overrides: { 'gpt-5.5': { output: 99 } } });
    expect(rate.output).toBe(99);
    expect(rate.input).toBe(DEFAULT_RATES['gpt-5.5']!.input);
  });
});

describe('priceTokensUsd', () => {
  // token buckets are disjoint: inputTokens is fresh (non-cached) input
  it('bills each disjoint bucket at its own rate', () => {
    const usd = priceTokensUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 },
      { input: 2, cachedInput: 0.5, output: 8 },
    );
    // 1M fresh × $2 + 1M cached × $0.5
    expect(usd).toBeCloseTo(2.5);
  });

  it('does not subtract cached from input (disjoint convention)', () => {
    const usd = priceTokensUsd(
      { inputTokens: 2_000_000, outputTokens: 500_000, cachedTokens: 1_000_000 },
      { input: 2, cachedInput: 0.5, output: 8 },
    );
    // 2M fresh × $2 + 1M cached × $0.5 + 0.5M out × $8
    expect(usd).toBeCloseTo(4 + 0.5 + 4);
  });

  it('bills cache writes at the cache-write rate', () => {
    const usd = priceTokensUsd(
      { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 1_000_000 },
      { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 25 },
    );
    expect(usd).toBeCloseTo(6.25);
  });

  it('switches to long-context rates above the threshold', () => {
    const rate = DEFAULT_RATES['gpt-5.5']!;
    const below = priceTokensUsd(
      { inputTokens: 272_000, outputTokens: 1_000_000, cachedTokens: 0 },
      rate,
    );
    const above = priceTokensUsd(
      { inputTokens: 272_001, outputTokens: 1_000_000, cachedTokens: 0 },
      rate,
    );
    expect(below).toBeCloseTo(0.272 * 5 + 30);
    expect(above).toBeCloseTo(0.272001 * 10 + 45);
  });

  it('prices official June 2026 rates for key models', () => {
    // Claude Fable 5 is twice the Opus tier per the official table
    expect(DEFAULT_RATES['claude-fable-5']).toEqual({
      input: 10.0,
      cachedInput: 1.0,
      cacheWrite: 12.5,
      output: 50.0,
    });
    expect(DEFAULT_RATES['gemini-3.5-flash']!.output).toBe(9.0);
    expect(DEFAULT_RATES['mai-code-1-flash']!.input).toBe(0.75);
    expect(DEFAULT_RATES['gemini-3.1-pro']!.longContext!.threshold).toBe(200_000);
  });
});

describe('priceUsage', () => {
  it('prefers billed nano credits over token math', () => {
    const priced = priceUsage(raw({ nanoCredits: 2_500_000_000, inputTokens: 1_000_000 }));
    expect(priced.credits).toBeCloseTo(2.5);
    expect(priced.costSource).toBe('billed');
  });

  it('computes from exact tokens otherwise', () => {
    const priced = priceUsage(raw({ model: 'gpt-5-mini', inputTokens: 1_000_000 }));
    // $0.25 → 25 credits
    expect(priced.credits).toBeCloseTo(25);
    expect(priced.costSource).toBe('computed');
  });

  it('marks estimated usage', () => {
    const priced = priceUsage(raw({ model: 'gpt-5-mini', inputTokens: 1000, estimated: true }));
    expect(priced.costSource).toBe('estimated');
  });

  it('prices billed premium requests at $0.04 each', () => {
    const priced = priceUsage(raw({ premiumRequests: 39, inputTokens: 13_000_000 }));
    // 39 × $0.04 = $1.56 = 156 credits
    expect(priced.credits).toBeCloseTo(156);
    expect(priced.costSource).toBe('billed');
  });
});

describe('creditsToUsd', () => {
  it('converts at $0.01 per credit', () => {
    expect(creditsToUsd(150)).toBeCloseTo(1.5);
  });
});
