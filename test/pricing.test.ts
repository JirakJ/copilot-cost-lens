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
    workspaceStorageDir: '/tmp/ws',
    timestamp: Date.now(),
    model: 'gpt-5.5',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
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
  it('bills cached tokens at the cached rate', () => {
    const usd = priceTokensUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 },
      { input: 2, cachedInput: 0.5, output: 8 },
    );
    expect(usd).toBeCloseTo(0.5);
  });

  it('prices a mixed request', () => {
    const usd = priceTokensUsd(
      { inputTokens: 2_000_000, outputTokens: 500_000, cachedTokens: 1_000_000 },
      { input: 2, cachedInput: 0.5, output: 8 },
    );
    // 1M fresh input × $2 + 1M cached × $0.5 + 0.5M out × $8
    expect(usd).toBeCloseTo(2 + 0.5 + 4);
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
});

describe('creditsToUsd', () => {
  it('converts at $0.01 per credit', () => {
    expect(creditsToUsd(150)).toBeCloseTo(1.5);
  });
});
