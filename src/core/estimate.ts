/**
 * Token estimation for chat sessions that carry no exact usage data.
 * Deliberately simple and transparent: characters / charsPerToken.
 */
export function estimateTokens(text: string, charsPerToken: number): number {
  return estimateTokensFromChars(text?.length ?? 0, charsPerToken);
}

export function estimateTokensFromChars(chars: number, charsPerToken: number): number {
  if (chars <= 0) {
    return 0;
  }
  return Math.ceil(chars / Math.max(1, charsPerToken));
}

/** Sum the length of every string nested anywhere inside a JSON value. */
export function totalTextLength(value: unknown, depth = 0): number {
  if (depth > 12 || value == null) {
    return 0;
  }
  if (typeof value === 'string') {
    return value.length;
  }
  if (Array.isArray(value)) {
    let sum = 0;
    for (const item of value) {
      sum += totalTextLength(item, depth + 1);
    }
    return sum;
  }
  if (typeof value === 'object') {
    let sum = 0;
    for (const v of Object.values(value)) {
      sum += totalTextLength(v, depth + 1);
    }
    return sum;
  }
  return 0;
}
