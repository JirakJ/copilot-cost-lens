import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, effectiveRates, priceUsage, rateFor } from '../src/core/pricing';
import { parsePricingMarkdown, PRICING_DOCS_URL } from '../src/core/pricingDocs';
import {
  fetchRemotePricing,
  isRemotePricingStale,
  REMOTE_PRICING_MAX_AGE_MS,
  sanitizeRemotePricing,
} from '../src/data/remotePricing';
import { RawUsage } from '../src/types';

const docs = fs.readFileSync(path.join(__dirname, 'fixtures', 'github-models-and-pricing.md'), 'utf8');

describe('parsePricingMarkdown (GitHub Docs price list)', () => {
  const rates = parsePricingMarkdown(docs);

  it('reads every vendor table, including models released after the build', () => {
    expect(rates['gemini-4-argon']).toEqual({ input: 2, cachedInput: 0.1, output: 10 });
    expect(rates['gemini-4-carbon']).toEqual({ input: 2, cachedInput: 0.1, output: 10 });
    expect(rates['kimi-k3']).toEqual({ input: 3, cachedInput: 0.3, output: 15 });
    expect(rates['mai-code-1.1-flash']).toEqual({ input: 0.2, cachedInput: 0.02, output: 1.2 });
    expect(rates['claude-fable-5.2']).toEqual({ input: 8, cachedInput: 0.2, cacheWrite: 10, output: 40 });
  });

  it('merges long-context tiers with their threshold and cache-write price', () => {
    expect(rates['gpt-6-astra']).toEqual({
      input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50,
      longContext: { threshold: 272_000, input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
    });
    expect(rates['grok-4.7']?.longContext).toEqual({ threshold: 200_000, input: 4, cachedInput: 1, output: 12 });
    expect(rates['gpt-5.6-luna']?.longContext?.threshold).toBe(200_000);
  });

  it('ignores image-generation and empty tables', () => {
    expect(Object.keys(rates).some((id) => id.includes('image'))).toBe(false);
    expect(Object.keys(rates).length).toBeGreaterThan(20);
  });

  it('agrees with the built-in table for every model both know', () => {
    for (const [id, rate] of Object.entries(rates)) {
      if (Object.hasOwn(DEFAULT_RATES, id)) expect(DEFAULT_RATES[id], id).toEqual(rate);
    }
  });

  it('tolerates column reordering, footnotes, links and junk rows', () => {
    const md = [
      '| Output | Cached input | Input | Model |',
      '| -: | -: | -: | --- |',
      '| $9.00 | $0.10 | $1.00 | [Some Model 2](/x)[^promo] |',
      '| n/a | $0.10 | $1.00 | Broken |',
      '| $1e9 | $0.10 | $1.00 | Huge |',
      'text',
      '| $1.00 | $0.10 | $1.00 | Outside table |',
    ].join('\n');
    expect(parsePricingMarkdown(md)).toEqual({ 'some-model-2': { input: 1, cachedInput: 0.1, output: 9 } });
  });
});

describe('fetchRemotePricing', () => {
  it('fetches only the public GitHub Docs page and stamps the result', async () => {
    const urls: string[] = [];
    const result = await fetchRemotePricing(async (url) => {
      urls.push(url);
      return docs;
    }, () => 42);
    expect(urls).toEqual([PRICING_DOCS_URL]);
    expect(result.fetchedAt).toBe(42);
    expect(result.rates['gemini-4-carbon']).toBeDefined();
  });

  it('rejects a page that is not the price list instead of wiping prices', async () => {
    await expect(fetchRemotePricing(async () => '<html>rate limited</html>')).rejects.toThrow(/only 0 models/);
  });
});

describe('cached remote pricing', () => {
  const good = { fetchedAt: 1000, source: PRICING_DOCS_URL, rates: parsePricingMarkdown(docs) };

  it('round-trips a valid cache and drops malformed entries', () => {
    const polluted = JSON.parse(JSON.stringify(good)) as Record<string, unknown> & { rates: Record<string, unknown> };
    polluted.rates['bad'] = { input: -1, cachedInput: 0, output: 0 };
    polluted.rates['worse'] = 'x';
    const clean = sanitizeRemotePricing(polluted)!;
    expect(clean.rates['bad']).toBeUndefined();
    expect(clean.rates['worse']).toBeUndefined();
    expect(clean.rates['gpt-6-astra']).toEqual(good.rates['gpt-6-astra']);
    expect(sanitizeRemotePricing(undefined)).toBeUndefined();
    expect(sanitizeRemotePricing({ fetchedAt: 1, rates: {} })).toBeUndefined();
  });

  it('is refreshed once a day', () => {
    expect(isRemotePricingStale(undefined)).toBe(true);
    expect(isRemotePricingStale(good, 1000 + REMOTE_PRICING_MAX_AGE_MS - 1)).toBe(false);
    expect(isRemotePricingStale(good, 1000 + REMOTE_PRICING_MAX_AGE_MS + 1)).toBe(true);
    expect(isRemotePricingStale(good, 0)).toBe(true); // clock went backwards
  });
});

describe('pricing with fetched rates', () => {
  const usage: RawUsage = {
    sessionId: 's', provider: 'copilot', timestamp: 1, model: 'gemini-9-neon',
    inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, estimated: false,
  };
  const rates = { 'gemini-9-neon': { input: 7, cachedInput: 0.7, output: 70 } };

  it('prices an unknown-to-the-build model from the fetched list', () => {
    expect(rateFor('gemini-9-neon').input).toBe(2); // fallback
    expect(rateFor('gemini-9-neon', { rates }).input).toBe(7);
    expect(priceUsage(usage, { rates }).credits).toBeCloseTo(700);
    expect(rateFor('gemini-9-neon-preview', { rates }).input).toBe(7);
  });

  it('lets user overrides win over fetched rates and keeps built-ins for the rest', () => {
    expect(rateFor('gemini-9-neon', { rates, overrides: { 'gemini-9-neon': { input: 1 } } }).input).toBe(1);
    expect(effectiveRates({ rates })['gpt-5-mini']).toEqual(DEFAULT_RATES['gpt-5-mini']);
  });
});
