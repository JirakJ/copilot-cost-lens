export interface DisplayCurrency {
  /** ISO 4217 code, e.g. USD, EUR, CZK. */
  code: string;
  /** Units of `code` per 1 USD; 1 when code is USD. */
  rate: number;
}

/** Format a USD amount in the display currency: `$12.34` or `123.45 CZK`. */
export function money(usdValue: number, currency: DisplayCurrency): string {
  if (currency.code === 'USD') {
    return `$${usdValue.toFixed(2)}`;
  }
  return `${(usdValue * currency.rate).toFixed(2)} ${currency.code}`;
}
