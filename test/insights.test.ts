import { describe, expect, it } from 'vitest';
import { cacheEconomics, savingsHeadroom } from '../src/core/insights';
import { ModelSummary } from '../src/types';

const M = 1_000_000;

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
    const r = cacheEconomics([model({ cachedTokens: M })]);
    expect(r.saved).toBeCloseTo(2.7);
    expect(r.paid).toBe(0);
    expect(r.net).toBeCloseTo(2.7);
  });

  it('charges cache writes at the model cacheWrite rate', () => {
    // claude-sonnet-4.5: cacheWrite 3.75 per 1M
    const r = cacheEconomics([model({ cacheWriteTokens: M })]);
    expect(r.paid).toBeCloseTo(3.75);
    expect(r.net).toBeCloseTo(-3.75);
  });

  it('charges nothing for cache writes on models that do not bill them', () => {
    const r = cacheEconomics([model({ model: 'gpt-5.4', cacheWriteTokens: M })]);
    expect(r.paid).toBe(0);
  });

  it('sums across models', () => {
    const r = cacheEconomics([
      model({ cachedTokens: M }),
      model({ model: 'gpt-5.4', cachedTokens: M }), // input 2.5, cached 0.25 → 2.25
    ]);
    expect(r.saved).toBeCloseTo(4.95);
  });

  it('returns zeroes for no models', () => {
    expect(cacheEconomics([])).toEqual({ saved: 0, paid: 0, net: 0 });
  });
});

describe('savingsHeadroom', () => {
  it('reprices an expensive model at the cheapest of its family', () => {
    // 100k stays under gpt-5.5's 272k long-context threshold, so base rates apply.
    // gpt-5.5: input 5.0, output 30.0 → 0.1M in + 0.1M out = $3.50
    // cheapest of the gpt family is gpt-5.4-nano: input 0.2, output 1.25 → $0.145
    const r = savingsHeadroom([model({ model: 'gpt-5.5', inputTokens: 100_000, outputTokens: 100_000 })]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.cheapest).toBe('gpt-5.4-nano');
    expect(r.rows[0]?.actualUsd).toBeCloseTo(3.5);
    expect(r.rows[0]?.counterfactualUsd).toBeCloseTo(0.145);
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
    const r = savingsHeadroom([model({ model: 'claude-opus-4.8', inputTokens: M })]);
    expect(r.rows[0]?.cheapest).toBe('claude-haiku-4');
  });

  it('contributes no headroom for a model outside the price table', () => {
    const r = savingsHeadroom([model({ model: 'totally-unknown-model', inputTokens: M })]);
    expect(r.rows).toHaveLength(0);
    expect(r.actualUsd).toBeCloseTo(r.counterfactualUsd);
  });

  it('sorts rows by absolute headroom, largest first', () => {
    const r = savingsHeadroom([
      model({ model: 'claude-opus-4.8', inputTokens: M }), // 5.0 → 1.0, headroom 4.0
      // 10M input crosses gpt-5.5's 272k threshold, so it bills at the 10.0 tier:
      // $100 actual; gpt-5.4-nano has no long-context tier → $2. Headroom 98.
      model({ model: 'gpt-5.5', inputTokens: 10 * M }),
    ]);
    expect(r.rows.map((x) => x.model)).toEqual(['gpt-5.5', 'claude-opus-4.8']);
  });
});
