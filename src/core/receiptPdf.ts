import * as zlib from 'node:zlib';
import { RepoDetail } from './aggregate';

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
  total: string;
  credits: string;
  estimatesNote: string;
  footer: string;
  providerNames: Record<string, string>;
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

export function buildReceiptPdf(detail: RepoDetail, strings: ReceiptStrings): Buffer {
  const lines = layoutReceipt(detail, strings);
  return renderPdf(lines);
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function layoutReceipt(detail: RepoDetail, t: ReceiptStrings): Line[] {
  const s = detail.summary;
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
  kv(t.project, fit(s.repo.name, COLS - t.project.length - 1));
  kv(t.period, detail.month === 'all' ? t.allTime : detail.month);
  kv(t.issued, new Date().toISOString().slice(0, 10));
  doubleRule();
  blank();

  for (const model of s.models) {
    out.push({ text: fit(model.model, COLS), bold: true });
    kv(`  ${t.requests}`, `${model.requestCount}x`);
    kv(`  ${t.credits}`, fmtNum(model.credits));
    kv('  USD', usd(model.usd));
    blank();
  }

  rule();
  kv(t.tokensIn, fmtNum(s.inputTokens));
  kv(t.tokensOut, fmtNum(s.outputTokens));
  kv(t.cacheRead, fmtNum(s.cachedTokens));
  kv(t.cacheWrite, fmtNum(s.cacheWriteTokens));
  kv(t.sessions, String(s.sessionCount));
  rule();

  if (detail.providers.length > 1) {
    out.push({ text: t.subtotalBySource, bold: true });
    for (const p of detail.providers) {
      kv(`  ${t.providerNames[p.provider] ?? p.provider}`, usd(p.usd));
    }
    rule();
  }

  blank();
  // size-12 type is wider, so the key/value spread uses fewer columns
  const totalCols = Math.floor((PAGE_W - 2 * MARGIN) / (12 * 0.6));
  out.push({
    text: padBetween(t.total, usd(s.usd), totalCols),
    bold: true,
    size: 12,
  });
  kv(t.credits, fmtNum(s.credits));
  blank();
  doubleRule();

  if (s.hasEstimates) {
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

function renderPdf(lines: Line[]): Buffer {
  const pageH = MARGIN * 2 + lines.length * LINE_H + 10;

  let content = '';
  let y = pageH - MARGIN - LINE_H;
  for (const line of lines) {
    const size = line.size ?? 10;
    const font = line.bold ? '/F2' : '/F1';
    const text = toWinAnsi(line.text);
    if (text.trim().length > 0) {
      const charW = size * 0.6; // Courier advance width
      const x = line.center
        ? Math.max(MARGIN, (PAGE_W - text.length * charW) / 2)
        : MARGIN;
      content += `BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET\n`;
    }
    y -= LINE_H;
  }

  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${Math.round(pageH)}] ` +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');
  objects.push(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n__STREAM__\nendstream`);

  const head = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const chunks: Buffer[] = [head];
  const offsets: number[] = [];
  let position = head.length;

  objects.forEach((body, index) => {
    offsets.push(position);
    let chunk: Buffer;
    if (body.includes('__STREAM__')) {
      const [before, after] = body.split('__STREAM__');
      chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n${before}`, 'latin1'),
        stream,
        Buffer.from(`${after}\nendobj\n`, 'latin1'),
      ]);
    } else {
      chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    }
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
