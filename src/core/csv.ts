import { UsageEvent } from '../types';

export function toCsv(events: UsageEvent[]): string {
  const header = [
    'timestamp',
    'provider',
    'repo',
    'model',
    'sessionId',
    'inputTokens',
    'outputTokens',
    'cachedTokens',
    'cacheWriteTokens',
    'credits',
    'usd',
    'costSource',
  ];
  const rows = events.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      e.provider,
      csvField(e.repo.name),
      csvField(e.model),
      e.sessionId,
      e.inputTokens,
      e.outputTokens,
      e.cachedTokens,
      e.cacheWriteTokens,
      e.credits.toFixed(4),
      (e.credits * 0.01).toFixed(4),
      e.costSource,
    ].join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

export function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
