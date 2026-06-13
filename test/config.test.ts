import { describe, expect, it } from 'vitest';
import {
  clampCharsPerToken,
  sanitizeNumberArray,
  sanitizePriceOverrides,
  sanitizeProjectGroups,
  sanitizeStringArray,
} from '../src/core/config';

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
