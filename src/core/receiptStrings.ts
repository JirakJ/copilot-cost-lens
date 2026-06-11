import { ReceiptStrings } from './receiptPdf';

/**
 * Receipt labels per locale. The PDF uses core fonts (WinAnsi only), so CJK
 * locales intentionally fall back to English; Latin locales are
 * transliterated inside the PDF writer.
 */
export function receiptStrings(locale: string): ReceiptStrings {
  const providerNames = {
    copilot: 'Copilot',
    'copilot-cli': 'Copilot CLI',
    'claude-code': 'Claude Code',
  };
  const lang = locale.toLowerCase().split(/[-_]/)[0];

  if (lang === 'cs') {
    return {
      receipt: 'UCTENKA',
      project: 'Projekt',
      period: 'Obdobi',
      issued: 'Vystaveno',
      allTime: 'od pocatku',
      model: 'Model',
      requests: 'pozadavky',
      tokensIn: 'Tokeny vstup',
      tokensOut: 'Tokeny vystup',
      cacheRead: 'Cache cteni',
      cacheWrite: 'Cache zapis',
      sessions: 'Sezeni',
      subtotalBySource: 'Mezisoucet dle zdroje',
      total: 'CELKEM',
      credits: 'Kredity',
      estimatesNote: 'Polozky oznacene ~ jsou odhady z delky obsahu.',
      footer: 'DEKUJEME ZA VASE TOKENY',
      providerNames,
    };
  }
  if (lang === 'de') {
    return {
      receipt: 'QUITTUNG',
      project: 'Projekt',
      period: 'Zeitraum',
      issued: 'Ausgestellt',
      allTime: 'gesamt',
      model: 'Modell',
      requests: 'Anfragen',
      tokensIn: 'Tokens Eingabe',
      tokensOut: 'Tokens Ausgabe',
      cacheRead: 'Cache Lesen',
      cacheWrite: 'Cache Schreiben',
      sessions: 'Sitzungen',
      subtotalBySource: 'Zwischensumme je Quelle',
      total: 'GESAMT',
      credits: 'Credits',
      estimatesNote: 'Mit ~ markierte Posten sind Schaetzungen.',
      footer: 'DANKE FUER IHRE TOKENS',
      providerNames,
    };
  }
  // en + CJK fallback (core PDF fonts cannot render CJK glyphs)
  return {
    receipt: 'RECEIPT',
    project: 'Project',
    period: 'Period',
    issued: 'Issued',
    allTime: 'all time',
    model: 'Model',
    requests: 'requests',
    tokensIn: 'Tokens in',
    tokensOut: 'Tokens out',
    cacheRead: 'Cache read',
    cacheWrite: 'Cache write',
    sessions: 'Sessions',
    subtotalBySource: 'Subtotal by source',
    total: 'TOTAL',
    credits: 'Credits',
    estimatesNote: 'Items marked ~ are estimates based on content length.',
    footer: 'THANK YOU FOR YOUR TOKENS',
    providerNames,
  };
}
