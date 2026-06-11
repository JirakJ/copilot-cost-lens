import * as zlib from 'node:zlib';
import { GroupDetail, RepoDetail } from './aggregate';
import { RepoSummary } from '../types';

/**
 * Receipt-style PDF for one project — a classic thermal-printer "účtenka":
 * narrow page, monospace type, dashed rules, model line items, totals.
 *
 * Hand-written PDF 1.4 with the built-in Courier core fonts, so there are no
 * runtime dependencies. Core fonts only cover WinAnsi (Latin-1-ish), so text
 * is transliterated; CJK locales receive English receipt labels.
 */

export interface ReceiptStrings {
  receipt: string;
  project: string;
  period: string;
  issued: string;
  allTime: string;
  model: string;
  requests: string;
  tokensIn: string;
  tokensOut: string;
  cacheRead: string;
  cacheWrite: string;
  sessions: string;
  subtotalBySource: string;
  byRepository: string;
  total: string;
  credits: string;
  estimatesNote: string;
  footer: string;
  providerNames: Record<string, string>;
}

interface ModelLine {
  model: string;
  requestCount: number;
  credits: number;
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
}

/** Everything a receipt needs — built from a repo or a project group. */
export interface ReceiptData {
  title: string;
  /** YYYY-MM or 'all'. */
  period: string;
  models: ModelLine[];
  /** Per-repository breakdown for project groups. */
  repoLines?: { name: string; usd: number }[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  sessionCount: number;
  providers: { provider: string; usd: number }[];
  totalCredits: number;
  totalUsd: number;
  hasEstimates: boolean;
}

export function receiptFromRepo(detail: RepoDetail): ReceiptData {
  const s = detail.summary;
  return {
    title: s.repo.name,
    period: detail.month,
    models: s.models,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cachedTokens: s.cachedTokens,
    cacheWriteTokens: s.cacheWriteTokens,
    sessionCount: s.sessionCount,
    providers: detail.providers,
    totalCredits: s.credits,
    totalUsd: s.usd,
    hasEstimates: s.hasEstimates,
  };
}

export function receiptFromGroup(detail: GroupDetail): ReceiptData {
  const g = detail.group;
  return {
    title: g.name,
    period: detail.month,
    models: g.models,
    repoLines: [...g.repos]
      .sort((a, b) => b.usd - a.usd)
      .map((r) => ({ name: r.repo.name, usd: r.usd })),
    inputTokens: g.inputTokens,
    outputTokens: g.outputTokens,
    cachedTokens: g.cachedTokens,
    cacheWriteTokens: g.cacheWriteTokens,
    sessionCount: g.sessionCount,
    providers: detail.providers,
    totalCredits: g.credits,
    totalUsd: g.usd,
    hasEstimates: g.hasEstimates,
  };
}

const PAGE_W = 240; // ~85mm thermal paper
const MARGIN = 14;
const LINE_H = 11;
const COLS = Math.floor((PAGE_W - 2 * MARGIN) / 6); // Courier 10pt ≈ 6pt/char

interface Line {
  text: string;
  bold?: boolean;
  size?: number;
  center?: boolean;
}

export function buildReceiptPdf(data: ReceiptData, strings: ReceiptStrings): Buffer {
  const lines = layoutReceipt(data, strings);
  // receipt: one page exactly as tall as its content
  return buildPdf([lines], PAGE_W, MARGIN * 2 + lines.length * LINE_H + 10);
}

// ---------------------------------------------------------------------------
// invoice (A4, paginated)
// ---------------------------------------------------------------------------

const A4_W = 595;
const A4_H = 842;
const A4_MARGIN = 56;
const A4_COLS = Math.floor((A4_W - 2 * A4_MARGIN) / 6); // Courier 10pt

export interface InvoiceStrings extends ReceiptStrings {
  invoice: string;
  repository: string;
  subtotal: string;
  grandTotal: string;
  generatedBy: string;
}

export interface InvoiceSection {
  repoName: string;
  requestCount: number;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  credits: number;
  usd: number;
  models: { model: string; requestCount: number; credits: number; usd: number }[];
  hasEstimates: boolean;
}

export interface InvoiceData {
  /** Project (group) or repository name. */
  title: string;
  /** YYYY-MM or 'all'. */
  period: string;
  sections: InvoiceSection[];
  providers: { provider: string; usd: number; requestCount: number }[];
  totalCredits: number;
  totalUsd: number;
  hasEstimates: boolean;
}

function sectionFromRepo(summary: RepoSummary): InvoiceSection {
  return {
    repoName: summary.repo.name,
    requestCount: summary.requestCount,
    sessionCount: summary.sessionCount,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    cachedTokens: summary.cachedTokens,
    cacheWriteTokens: summary.cacheWriteTokens,
    credits: summary.credits,
    usd: summary.usd,
    models: summary.models,
    hasEstimates: summary.hasEstimates,
  };
}

/** Summary invoice for a project group, one section per member repository. */
export function invoiceFromGroup(detail: GroupDetail): InvoiceData {
  const repos = [...detail.group.repos].sort((a, b) => b.credits - a.credits);
  return {
    title: detail.group.name,
    period: detail.month,
    sections: repos.map(sectionFromRepo),
    providers: detail.providers,
    totalCredits: detail.group.credits,
    totalUsd: detail.group.usd,
    hasEstimates: detail.group.hasEstimates,
  };
}

/** Single-repository invoice. */
export function invoiceFromRepo(detail: RepoDetail): InvoiceData {
  return {
    title: detail.summary.repo.name,
    period: detail.month,
    sections: [sectionFromRepo(detail.summary)],
    providers: detail.providers,
    totalCredits: detail.summary.credits,
    totalUsd: detail.summary.usd,
    hasEstimates: detail.summary.hasEstimates,
  };
}

export function buildInvoicePdf(data: InvoiceData, t: InvoiceStrings): Buffer {
  const lines = layoutInvoice(data, t);
  const linesPerPage = Math.floor((A4_H - 2 * A4_MARGIN) / LINE_H);
  const pages: Line[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return buildPdf(pages.length > 0 ? pages : [[]], A4_W, A4_H, A4_MARGIN);
}

function layoutInvoice(data: InvoiceData, t: InvoiceStrings): Line[] {
  const out: Line[] = [];
  const rule = () => out.push({ text: '-'.repeat(A4_COLS) });
  const doubleRule = () => out.push({ text: '='.repeat(A4_COLS) });
  const kv = (label: string, value: string) => out.push({ text: padBetween(label, value, A4_COLS) });
  const blank = () => out.push({ text: '' });

  out.push({ text: t.invoice, bold: true, size: 16 });
  out.push({ text: 'Copilot Cost Lens', size: 9 });
  blank();
  doubleRule();
  kv(t.project, fit(data.title, A4_COLS - t.project.length - 1));
  kv(t.period, data.period === 'all' ? t.allTime : data.period);
  kv(t.issued, new Date().toISOString().slice(0, 10));
  doubleRule();
  blank();

  // column layout: model/name | requests | credits | USD
  const wReq = 10;
  const wCr = 14;
  const wUsd = 12;
  const wName = A4_COLS - wReq - wCr - wUsd;
  const row = (name: string, req: string, credits: string, usdText: string, bold = false) =>
    out.push({
      text:
        fit(name, wName).padEnd(wName) +
        req.padStart(wReq) +
        credits.padStart(wCr) +
        usdText.padStart(wUsd),
      bold,
    });

  row(t.repository, t.requests, t.credits, 'USD', true);
  rule();

  for (const section of data.sections) {
    row(section.repoName + (section.hasEstimates ? ' ~' : ''), '', '', '', true);
    for (const model of section.models) {
      row('  ' + model.model, `${model.requestCount}x`, fmtNum(model.credits), usd(model.usd));
    }
    row(
      '  ' + t.subtotal,
      `${section.requestCount}x`,
      fmtNum(section.credits),
      usd(section.usd),
      true,
    );
    kv(
      `  ${t.tokensIn}/${t.tokensOut}`,
      `${fmtNum(section.inputTokens)} / ${fmtNum(section.outputTokens)}`,
    );
    kv(
      `  ${t.cacheRead}/${t.cacheWrite}`,
      `${fmtNum(section.cachedTokens)} / ${fmtNum(section.cacheWriteTokens)}`,
    );
    blank();
  }

  rule();
  if (data.providers.length > 1) {
    out.push({ text: t.subtotalBySource, bold: true });
    for (const p of data.providers) {
      kv(`  ${t.providerNames[p.provider] ?? p.provider}`, usd(p.usd));
    }
    rule();
  }

  blank();
  const totalCols = Math.floor((A4_W - 2 * A4_MARGIN) / (13 * 0.6));
  out.push({ text: padBetween(t.grandTotal, usd(data.totalUsd), totalCols), bold: true, size: 13 });
  kv(t.credits, fmtNum(data.totalCredits));
  doubleRule();

  if (data.hasEstimates) {
    blank();
    for (const wrapped of wrap(`~ ${t.estimatesNote}`, A4_COLS)) {
      out.push({ text: wrapped, size: 8 });
    }
  }
  blank();
  out.push({ text: t.generatedBy, size: 8 });

  return out;
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function layoutReceipt(data: ReceiptData, t: ReceiptStrings): Line[] {
  const out: Line[] = [];
  const rule = () => out.push({ text: '-'.repeat(COLS) });
  const doubleRule = () => out.push({ text: '='.repeat(COLS) });
  const kv = (label: string, value: string) =>
    out.push({ text: padBetween(label, value, COLS) });
  const blank = () => out.push({ text: '' });

  out.push({ text: 'COPILOT COST LENS', bold: true, size: 12, center: true });
  out.push({ text: `* ${t.receipt} *`, center: true });
  blank();
  doubleRule();
  kv(t.project, fit(data.title, COLS - t.project.length - 1));
  kv(t.period, data.period === 'all' ? t.allTime : data.period);
  kv(t.issued, new Date().toISOString().slice(0, 10));
  doubleRule();
  blank();

  for (const model of data.models) {
    out.push({ text: fit(model.model, COLS), bold: true });
    kv(`  ${t.requests}`, `${model.requestCount}x`);
    kv(`  ${t.credits}`, fmtNum(model.credits));
    kv('  USD', usd(model.usd));
    const effective = effectiveRatePerMillion(model);
    if (effective !== undefined) {
      kv('  ~$/1M', usd(effective));
    }
    blank();
  }

  if (data.repoLines && data.repoLines.length > 0) {
    rule();
    out.push({ text: t.byRepository, bold: true });
    for (const line of data.repoLines) {
      kv(`  ${fit(line.name, COLS - 12)}`, usd(line.usd));
    }
    blank();
  }

  rule();
  kv(t.tokensIn, fmtNum(data.inputTokens));
  kv(t.tokensOut, fmtNum(data.outputTokens));
  kv(t.cacheRead, fmtNum(data.cachedTokens));
  kv(t.cacheWrite, fmtNum(data.cacheWriteTokens));
  kv(t.sessions, String(data.sessionCount));
  rule();

  if (data.providers.length > 1) {
    out.push({ text: t.subtotalBySource, bold: true });
    for (const p of data.providers) {
      kv(`  ${t.providerNames[p.provider] ?? p.provider}`, usd(p.usd));
    }
    rule();
  }

  blank();
  // size-12 type is wider, so the key/value spread uses fewer columns
  const totalCols = Math.floor((PAGE_W - 2 * MARGIN) / (12 * 0.6));
  out.push({
    text: padBetween(t.total, usd(data.totalUsd), totalCols),
    bold: true,
    size: 12,
  });
  kv(t.credits, fmtNum(data.totalCredits));
  blank();
  doubleRule();

  if (data.hasEstimates) {
    blank();
    for (const wrapped of wrap(`~ ${t.estimatesNote}`, COLS)) {
      out.push({ text: wrapped, size: 8 });
    }
  }
  blank();
  out.push({ text: `*** ${t.footer} ***`, center: true, size: 8 });

  return out;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Blended price actually paid per 1M tokens, cache effects included. */
function effectiveRatePerMillion(line: ModelLine): number | undefined {
  const total =
    (line.inputTokens ?? 0) +
    (line.outputTokens ?? 0) +
    (line.cachedTokens ?? 0) +
    (line.cacheWriteTokens ?? 0);
  return total > 0 ? (line.usd / total) * 1_000_000 : undefined;
}

function fmtNum(value: number): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return rounded.toLocaleString('en-US');
}

function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(1, width - 1)) + '~' : text;
}

function padBetween(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// minimal PDF writer (PDF 1.4, Courier core fonts, FlateDecode)
// ---------------------------------------------------------------------------

/** Map characters outside WinAnsi to close ASCII equivalents. */
export function toWinAnsi(text: string): string {
  const translit: Record<string, string> = {
    á: 'a', č: 'c', ď: 'd', é: 'e', ě: 'e', í: 'i', ň: 'n', ó: 'o', ř: 'r',
    š: 's', ť: 't', ú: 'u', ů: 'u', ý: 'y', ž: 'z',
    Á: 'A', Č: 'C', Ď: 'D', É: 'E', Ě: 'E', Í: 'I', Ň: 'N', Ó: 'O', Ř: 'R',
    Š: 'S', Ť: 'T', Ú: 'U', Ů: 'U', Ý: 'Y', Ž: 'Z',
    ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue',
    '—': '-', '–': '-', '·': '*', '×': 'x', '…': '...',
  };
  let result = '';
  for (const ch of text) {
    if (translit[ch] !== undefined) {
      result += translit[ch];
    } else if (ch.charCodeAt(0) <= 0xff) {
      result += ch;
    } else {
      result += '?';
    }
  }
  return result;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Assemble a PDF from pre-paginated lines. Fonts: F1 Courier, F2 Courier-Bold. */
function buildPdf(pages: Line[][], pageW: number, pageH: number, margin = MARGIN): Buffer {
  interface PdfObject {
    body: string;
    stream?: Buffer;
  }

  // object ids: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page, contents
  const firstPageId = 5;
  const kids = pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(' ');

  const objects: PdfObject[] = [
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>` },
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>' },
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>' },
  ];

  for (const [index, lines] of pages.entries()) {
    let content = '';
    let y = pageH - margin - LINE_H;
    for (const line of lines) {
      const size = line.size ?? 10;
      const font = line.bold ? '/F2' : '/F1';
      const text = toWinAnsi(line.text);
      if (text.trim().length > 0) {
        const charW = size * 0.6; // Courier advance width
        const x = line.center ? Math.max(margin, (pageW - text.length * charW) / 2) : margin;
        content += `BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET\n`;
      }
      y -= LINE_H;
    }
    const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const contentsId = firstPageId + index * 2 + 1;
    objects.push({
      body:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${Math.round(pageH)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentsId} 0 R >>`,
    });
    objects.push({
      body: `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
      stream,
    });
  }

  const head = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const chunks: Buffer[] = [head];
  const offsets: number[] = [];
  let position = head.length;

  objects.forEach((object, index) => {
    offsets.push(position);
    const parts: Buffer[] = [Buffer.from(`${index + 1} 0 obj\n${object.body}`, 'latin1')];
    if (object.stream) {
      parts.push(object.stream, Buffer.from('\nendstream', 'latin1'));
    }
    parts.push(Buffer.from('\nendobj\n', 'latin1'));
    const chunk = Buffer.concat(parts);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}
