import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GroupDetail, RepoDetail } from '../src/core/aggregate';
import {
  buildInvoicePdf,
  buildReceiptPdf,
  invoiceFromGroup,
  receiptFromGroup,
  receiptFromRepo,
  toWinAnsi,
} from '../src/core/receiptPdf';
import { invoiceStrings, receiptStrings } from '../src/core/receiptStrings';

function sampleDetail(): RepoDetail {
  return {
    month: '2026-06',
    firstActivity: Date.UTC(2026, 5, 1),
    topSessions: [],
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
        { model: 'claude-fable-5', credits: 900, usd: 9, requestCount: 10, inputTokens: 500_000, outputTokens: 40_000, cachedTokens: 300_000, cacheWriteTokens: 60_000 },
        { model: 'gpt-5.5', credits: 100, usd: 1, requestCount: 5, inputTokens: 100_000, outputTokens: 10_000, cachedTokens: 0, cacheWriteTokens: 0 },
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
    const pdf = buildReceiptPdf(receiptFromRepo(sampleDetail()), receiptStrings('en'));
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Page');
    expect(text).toContain('/BaseFont /Courier');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('contains the project, totals and models in the content stream', () => {
    const pdf = buildReceiptPdf(receiptFromRepo(sampleDetail()), receiptStrings('cs'));
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

  it('renders a per-repository breakdown for project groups', () => {
    const detail: GroupDetail = {
      month: 'all',
      days: [],
      providers: [{ provider: 'copilot', credits: 1000, usd: 10, requestCount: 15 }],
      group: {
        name: 'MyProduct',
        repos: [
          { ...sampleDetail().summary, repo: { name: 'acme/frontend' }, usd: 6 },
          { ...sampleDetail().summary, repo: { name: 'acme/backend' }, usd: 4 },
        ],
        credits: 1000,
        usd: 10,
        inputTokens: 2_000_000,
        outputTokens: 100_000,
        cachedTokens: 1_600_000,
        cacheWriteTokens: 120_000,
        requestCount: 30,
        sessionCount: 6,
        models: [{ model: 'gpt-5.5', credits: 1000, usd: 10, requestCount: 30, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }],
        hasEstimates: false,
      },
    };
    const pdf = buildReceiptPdf(receiptFromGroup(detail), receiptStrings('cs'));
    const raw = pdf.toString('latin1');
    const streamStart = raw.indexOf('>>\nstream\n') + '>>\nstream\n'.length;
    const streamEnd = raw.indexOf('\nendstream');
    const content = zlib
      .inflateSync(Buffer.from(raw.slice(streamStart, streamEnd), 'latin1'))
      .toString('latin1');
    expect(content).toContain('MyProduct');
    expect(content).toContain('Rozpad dle repozitaru');
    expect(content).toContain('acme/frontend');
    expect(content).toContain('acme/backend');
    expect(content).toContain('$10.00');
  });
});

describe('buildInvoicePdf', () => {
  function groupDetail(repoCount: number): GroupDetail {
    const repos = Array.from({ length: repoCount }, (_, i) => ({
      ...sampleDetail().summary,
      repo: { name: `acme/repo-${i}` },
    }));
    return {
      month: 'all',
      days: [],
      providers: [{ provider: 'copilot', credits: 1000, usd: 10, requestCount: 15 }],
      group: {
        name: 'MyProduct',
        repos,
        credits: 1000 * repoCount,
        usd: 10 * repoCount,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        requestCount: 15 * repoCount,
        sessionCount: 3 * repoCount,
        models: [{ model: 'gpt-5.5', credits: 1000 * repoCount, usd: 10 * repoCount, requestCount: 15 * repoCount, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 }],
        hasEstimates: false,
      },
    };
  }

  it('renders a per-repo breakdown with a grand total', () => {
    const pdf = buildInvoicePdf(invoiceFromGroup(groupDetail(2)), invoiceStrings('en'));
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-1.4')).toBe(true);
    const content = inflateStreams(raw);
    expect(content).toContain('INVOICE - AI UTILIZATION');
    expect(content).toContain('MyProduct');
    expect(content).toContain('acme/repo-0');
    expect(content).toContain('acme/repo-1');
    expect(content).toContain('GRAND TOTAL');
    expect(content).toContain('$20.00');
  });

  it('paginates long invoices across multiple A4 pages', () => {
    const pdf = buildInvoicePdf(invoiceFromGroup(groupDetail(20)), invoiceStrings('en'));
    const raw = pdf.toString('latin1');
    const pageCount = Number(/\/Count (\d+)/.exec(raw)?.[1]);
    expect(pageCount).toBeGreaterThan(1);
    expect(inflateStreams(raw)).toContain('acme/repo-19');
  });
});

function inflateStreams(raw: string): string {
  const marker = '>>\nstream\n';
  let content = '';
  let cursor = 0;
  for (;;) {
    const start = raw.indexOf(marker, cursor);
    if (start < 0) {
      break;
    }
    const end = raw.indexOf('\nendstream', start);
    content += zlib
      .inflateSync(Buffer.from(raw.slice(start + marker.length, end), 'latin1'))
      .toString('latin1');
    cursor = end;
  }
  return content;
}
