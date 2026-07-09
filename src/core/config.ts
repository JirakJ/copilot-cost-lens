import { ModelRate } from '../types';

/**
 * Defensive parsing of user-supplied configuration. Bad values (wrong types,
 * negatives, NaN) are dropped rather than allowed to break a scan or pricing.
 */

export function sanitizeStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string' && r.length > 0) : [];
}

export function clampCharsPerToken(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? raw : 4;
}

export function sanitizeNumberArray(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    : [];
}

export function sanitizePriceOverrides(raw: unknown): Record<string, Partial<ModelRate>> {
  const out: Record<string, Partial<ModelRate>> = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const clean: Partial<ModelRate> = {};
    for (const key of ['input', 'cachedInput', 'cacheWrite', 'output'] as const) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        clean[key] = v;
      }
    }
    if (Object.keys(clean).length > 0) {
      out[model] = clean;
    }
  }
  return out;
}

/** Parse the repo-alias map (original name → display name), dropping malformed entries. */
export function sanitizeRepoAliases(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.trim() && typeof value === 'string' && value.trim()) {
      out[key.trim()] = value.trim();
    }
  }
  return out;
}

/** Parse a project-groups config object, dropping malformed entries. */
export function sanitizeProjectGroups(raw: unknown): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') {
    return groups;
  }
  for (const [name, members] of Object.entries(raw as Record<string, unknown>)) {
    const list = sanitizeStringArray(members);
    if (name.trim() && list.length > 0) {
      groups[name] = list;
    }
  }
  return groups;
}
