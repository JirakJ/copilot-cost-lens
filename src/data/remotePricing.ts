import * as https from 'node:https';
import { MIN_REMOTE_MODELS, parsePricingMarkdown, PRICING_DOCS_URL } from '../core/pricingDocs';
import { ModelRate } from '../types';

/** Fetched official price list, persisted in globalState between sessions. */
export interface RemotePricing {
  fetchedAt: number;
  source: string;
  rates: Record<string, ModelRate>;
}

/** Refresh the official price list at most this often. */
export const REMOTE_PRICING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type TextFetcher = (url: string) => Promise<string>;

/**
 * Download and parse GitHub's official Copilot price list. Only a plain GET
 * of a public docs page — nothing about the user or their usage is sent.
 * Throws when the page cannot be fetched or does not look like the price list.
 */
export async function fetchRemotePricing(
  fetchText: TextFetcher = httpsGetText,
  now: () => number = Date.now,
): Promise<RemotePricing> {
  const markdown = await fetchText(PRICING_DOCS_URL);
  const rates = parsePricingMarkdown(markdown);
  const count = Object.keys(rates).length;
  if (count < MIN_REMOTE_MODELS) {
    throw new Error(`price list returned only ${count} models — keeping previous prices`);
  }
  return { fetchedAt: now(), source: PRICING_DOCS_URL, rates };
}

/** Validate a cached value read back from globalState (untrusted shape). */
export function sanitizeRemotePricing(value: unknown): RemotePricing | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Partial<RemotePricing>;
  if (typeof v.fetchedAt !== 'number' || !Number.isFinite(v.fetchedAt)) return undefined;
  if (typeof v.rates !== 'object' || v.rates === null) return undefined;
  const rates: Record<string, ModelRate> = Object.create(null) as Record<string, ModelRate>;
  for (const [id, rate] of Object.entries(v.rates)) {
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    if (isRate(rate)) rates[id] = rate;
  }
  if (Object.keys(rates).length < MIN_REMOTE_MODELS) return undefined;
  return { fetchedAt: v.fetchedAt, source: typeof v.source === 'string' ? v.source : PRICING_DOCS_URL, rates: { ...rates } };
}

export function isRemotePricingStale(cached: RemotePricing | undefined, now = Date.now()): boolean {
  return !cached || now - cached.fetchedAt > REMOTE_PRICING_MAX_AGE_MS || cached.fetchedAt > now;
}

function isPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10_000;
}

function isRate(value: unknown): value is ModelRate {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as ModelRate;
  if (!isPrice(r.input) || !isPrice(r.cachedInput) || !isPrice(r.output)) return false;
  if (r.cacheWrite !== undefined && !isPrice(r.cacheWrite)) return false;
  if (r.longContext !== undefined) {
    const lc = r.longContext;
    if (typeof lc !== 'object' || lc === null || !isPrice(lc.input) || !isPrice(lc.cachedInput) ||
        !isPrice(lc.output) || typeof lc.threshold !== 'number' || !(lc.threshold > 0) ||
        (lc.cacheWrite !== undefined && !isPrice(lc.cacheWrite))) {
      return false;
    }
  }
  return true;
}

/** Minimal HTTPS GET (Node 16 extension hosts have no global fetch). */
export function httpsGetText(url: string, redirectsLeft = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'copilot-cost-lens', Accept: 'text/markdown, text/plain, */*' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url);
        if (next.protocol !== 'https:' || next.hostname !== 'docs.github.com') {
          reject(new Error(`refusing redirect to ${next.hostname}`));
          return;
        }
        httpsGetText(next.toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error('price list too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}
