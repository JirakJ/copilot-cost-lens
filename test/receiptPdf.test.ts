import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RepoDetail } from '../src/core/aggregate';
import { buildReceiptPdf, toWinAnsi } from '../src/core/receiptPdf';
import { receiptStrings } from '../src/core/receiptStrings';

function sampleDetail(): RepoDetail {
  return {
    month: '2026-06',
    firstActivity: Date.UTC(2026, 5, 1),
    days: [{ day: '2026-06-01', credits: 100, usd: 1 }],
    providers: [
      { provider: 'claude-code', credits: 900, usd: 9, requestCount: 10 },
      { provider: 'copilot', credits: 100, usd: 1, requestCount: 5 },
    ],
    summary: {
      repo: { name: 'JirakJ/copilot-cost-lens' },
      credits: 1000,
      usd: 10,
      inputTokens: 1_000_000,
      outputTokens: 50_000,
      cachedTokens: 800_000,
      cacheWriteTokens: 60_000,
      requestCount: 15,
      sessionCount: 3,
      models: [
        { model: 'claude-fable-5', credits: 900, usd: 9, requestCount: 10 },
        { model: 'gpt-5.5', credits: 100, usd: 1, requestCount: 5 },
      ],
      providers: ['claude-code', 'copilot'],
      lastActivity: Date.UTC(2026, 5, 10),
      hasEstimates: true,
    },
  };
}

describe('toWinAnsi', () => {
  it('transliterates Czech diacritics and typography', () => {
    expect(toWinAnsi('Děkujeme — účtenka č. 1')).toBe('Dekujeme - uctenka c. 1');
  });

  it('replaces non-Latin characters with ?', () => {
    expect(toWinAnsi('レシート')).toBe('????');
  });
});

describe('buildReceiptPdf', () => {
  it('produces a structurally valid single-page PDF', () => {
    const pdf = buildReceiptPdf(sampleDetail(), receiptStrings('en'));
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Page');
    expect(text).toContain('/BaseFont /Courier');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('contains the project, totals and models in the content stream', () => {
    const pdf = buildReceiptPdf(sampleDetail(), receiptStrings('cs'));
    const raw = pdf.toString('latin1');
    const streamStart = raw.indexOf('stream\n') + 'stream\n'.length;
    const streamEnd = raw.indexOf('\nendstream');
    const content = zlib
      .inflateSync(Buffer.from(raw.slice(streamStart, streamEnd), 'latin1'))
      .toString('latin1');

    expect(content).toContain('JirakJ/copilot-cost-lens');
    expect(content).toContain('UCTENKA');
    expect(content).toContain('claude-fable-5');
    expect(content).toContain('$10.00');
    expect(content).toContain('CELKEM');
  });

  it('falls back to English labels for CJK locales', () => {
    const strings = receiptStrings('ja');
    expect(strings.receipt).toBe('RECEIPT');
  });
});
