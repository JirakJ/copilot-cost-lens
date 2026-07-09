import { describe, expect, it } from 'vitest';
import {
  clampCharsPerToken,
  sanitizeBudgetMap,
  sanitizeCurrency,
  sanitizeNumberArray,
  sanitizePriceOverrides,
  sanitizeProjectGroups,
  sanitizeRepoAliases,
  sanitizeStringArray,
} from '../src/core/config';
import { money } from '../src/core/money';

describe('sanitizeStringArray', () => {
  it('keeps only non-empty strings', () => {
    expect(sanitizeStringArray(['a', '', 1, null, 'b'])).toEqual(['a', 'b']);
  });
  it('tolerates non-array input', () => {
    expect(sanitizeStringArray('nope')).toEqual([]);
    expect(sanitizeStringArray(undefined)).toEqual([]);
  });
});

describe('clampCharsPerToken', () => {
  it('keeps valid ratios', () => {
    expect(clampCharsPerToken(3.5)).toBe(3.5);
  });
  it('falls back to 4 for invalid values', () => {
    expect(clampCharsPerToken(0)).toBe(4);
    expect(clampCharsPerToken(-2)).toBe(4);
    expect(clampCharsPerToken(NaN)).toBe(4);
    expect(clampCharsPerToken('x')).toBe(4);
  });
});

describe('sanitizeNumberArray', () => {
  it('keeps positive finite numbers', () => {
    expect(sanitizeNumberArray([2500, 0, -1, 'x', Infinity, 5000])).toEqual([2500, 5000]);
  });
});

describe('sanitizePriceOverrides', () => {
  it('drops bad models and bad fields', () => {
    const result = sanitizePriceOverrides({
      'gpt-5.5': { input: 5, output: -1, cachedInput: 'x', cacheWrite: 2 },
      bad: 'not an object',
      empty: { input: NaN },
    });
    expect(result).toEqual({ 'gpt-5.5': { input: 5, cacheWrite: 2 } });
  });
  it('tolerates non-object input', () => {
    expect(sanitizePriceOverrides(null)).toEqual({});
    expect(sanitizePriceOverrides([])).toEqual({});
  });
});

describe('sanitizeProjectGroups', () => {
  it('keeps named groups with members', () => {
    expect(
      sanitizeProjectGroups({
        Product: ['a', 'b'],
        Empty: [],
        '   ': ['c'],
        bad: 'x',
      }),
    ).toEqual({ Product: ['a', 'b'] });
  });
});

describe('sanitizeRepoAliases', () => {
  it('keeps non-empty string aliases with non-empty keys', () => {
    expect(
      sanitizeRepoAliases({
        '(unknown) 2bebdc79': 'Backend API',
        '   ': 'x',
        empty: '',
        bad: 42,
      }),
    ).toEqual({ '(unknown) 2bebdc79': 'Backend API' });
  });
  it('trims keys and values so lookups match resolved names', () => {
    expect(sanitizeRepoAliases({ '  (unknown) x  ': '  Foo  ' })).toEqual({ '(unknown) x': 'Foo' });
  });
  it('tolerates non-object input', () => {
    expect(sanitizeRepoAliases(null)).toEqual({});
    expect(sanitizeRepoAliases([])).toEqual({});
  });
});

describe('sanitizeBudgetMap', () => {
  it('keeps positive finite numbers with non-empty keys', () => {
    expect(sanitizeBudgetMap({ App: 50, ' ': 5, Zero: 0, Neg: -1, Bad: 'x', Inf: Infinity })).toEqual(
      { App: 50 },
    );
    expect(sanitizeBudgetMap(null)).toEqual({});
  });
});

describe('sanitizeCurrency + money', () => {
  it('normalizes code and guards the rate', () => {
    expect(sanitizeCurrency(' czk ', 23.5)).toEqual({ code: 'CZK', rate: 23.5 });
    expect(sanitizeCurrency('EURO', 2)).toEqual({ code: 'USD', rate: 1 });
    expect(sanitizeCurrency('EUR', -1)).toEqual({ code: 'EUR', rate: 1 });
    expect(sanitizeCurrency('EUR', NaN)).toEqual({ code: 'EUR', rate: 1 });
    expect(sanitizeCurrency('usd', 42)).toEqual({ code: 'USD', rate: 1 });
  });
  it('formats USD with $ and other currencies with code suffix', () => {
    expect(money(12.345, { code: 'USD', rate: 1 })).toBe('$12.35');
    expect(money(10, { code: 'CZK', rate: 23.5 })).toBe('235.00 CZK');
  });
});
