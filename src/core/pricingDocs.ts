import { ModelRate } from '../types';
import { normalizeModelId } from './pricing';

/**
 * Official GitHub Copilot price list, served as Markdown by the GitHub Docs
 * article API. Public, unauthenticated, and contains no user data.
 */
export const PRICING_DOCS_URL =
  'https://docs.github.com/api/article/body?pathname=/en/copilot/reference/copilot-billing/models-and-pricing';

/** A parse that yields fewer models than this is treated as a broken page. */
export const MIN_REMOTE_MODELS = 5;

/** Upper bound on any per-1M-token price we accept from the network. */
const MAX_PRICE_USD = 10_000;

interface Columns {
  model: number;
  tier?: number;
  threshold?: number;
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
}

/**
 * Parse the "Models and pricing for GitHub Copilot" Markdown into a rate
 * table keyed by normalized model id.
 *
 * Tables are recognised by their header row (Model / Input / Cached input /
 * Output, optional Tier / Threshold / Cache write), so column order and new
 * vendor sections do not matter. Rows that do not parse are skipped. Tables
 * without a plain "Output" column (image generation) are ignored.
 */
export function parsePricingMarkdown(markdown: string): Record<string, ModelRate> {
  const defaults = new Map<string, ModelRate>();
  const longContext = new Map<string, NonNullable<ModelRate['longContext']>>();
  let columns: Columns | undefined;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      columns = undefined; // a table ends at the first non-table line
      continue;
    }
    const cells = splitRow(line);
    const header = headerColumns(cells);
    if (header) {
      columns = header;
      continue;
    }
    if (!columns || cells.every((c) => c === '' || /^:?-+:?$/.test(c))) {
      continue;
    }

    const name = cleanModelName(cells[columns.model] ?? '');
    const input = price(cells[columns.input]);
    const cachedInput = price(cells[columns.cachedInput]);
    const output = price(cells[columns.output]);
    if (!name || input === undefined || cachedInput === undefined || output === undefined) {
      continue;
    }
    const cacheWrite = columns.cacheWrite !== undefined ? price(cells[columns.cacheWrite]) : undefined;
    const id = normalizeModelId(name);
    const tier = columns.tier !== undefined ? (cells[columns.tier] ?? '').toLowerCase() : '';

    if (tier.includes('long')) {
      const threshold = parseThreshold(cells[columns.threshold ?? -1]);
      if (threshold !== undefined) {
        longContext.set(id, {
          threshold, input, cachedInput, output,
          ...(cacheWrite !== undefined ? { cacheWrite } : {}),
        });
      }
    } else if (!defaults.has(id)) {
      defaults.set(id, { input, cachedInput, output, ...(cacheWrite !== undefined ? { cacheWrite } : {}) });
    }
  }

  const rates: Record<string, ModelRate> = {};
  for (const [id, rate] of defaults) {
    const lc = longContext.get(id);
    rates[id] = lc ? { ...rate, longContext: lc } : rate;
  }
  return rates;
}

function splitRow(line: string): string[] {
  const inner = line.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function headerColumns(cells: string[]): Columns | undefined {
  const names = cells.map((c) => c.toLowerCase().replace(/\s+/g, ' ').trim());
  const at = (label: string) => {
    const i = names.indexOf(label);
    return i >= 0 ? i : undefined;
  };
  const model = at('model');
  const input = at('input');
  const cachedInput = at('cached input');
  const output = at('output');
  if (model === undefined || input === undefined || cachedInput === undefined || output === undefined) {
    return undefined;
  }
  return {
    model, input, cachedInput, output,
    tier: at('tier'),
    threshold: names.findIndex((n) => n.startsWith('threshold')) >= 0
      ? names.findIndex((n) => n.startsWith('threshold'))
      : undefined,
    cacheWrite: at('cache write'),
  };
}

/** "Gemini 4 Argon[^gemini-4-argon-promo]" → "Gemini 4 Argon". */
function cleanModelName(cell: string): string {
  return cell
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

function price(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const m = /^\$?\s*(\d+(?:\.\d+)?)$/.exec(cell.replace(/,/g, '').trim());
  if (!m) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_USD ? value : undefined;
}

/** "> 272K" / "≤ 200K" / "> 1M" → tokens. */
function parseThreshold(cell: string | undefined): number | undefined {
  if (!cell) return undefined;
  const m = /(\d+(?:\.\d+)?)\s*([km])?/i.exec(cell.replace(/,/g, ''));
  if (!m) return undefined;
  const unit = (m[2] ?? '').toLowerCase();
  const value = Number(m[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}
