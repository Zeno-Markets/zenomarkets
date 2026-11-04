/// Display-only reference prices for stocks and ETFs, from Robinhood's public quote endpoint. They never reach
/// `ZenoPriceValidator` or settlement: a market with a Chainlink feed settles on the feed, and every other row on
/// the Markets page (the China names without a feed) is a price to read, nothing more.

export const REFERENCE_QUOTES_URL = "https://api.robinhood.com/quotes/";

export interface ReferenceQuote {
  /// Mid of bid and ask in USD, or the last trade when one side is missing or the book is too wide to mean a price.
  price: number;
  /// Change from the previous close, in basis points, or null when the source gave no previous close.
  changeBps: number | null;
  /// ISO time the source updated the quote.
  asOf: string;
}

interface RawQuote {
  symbol?: string;
  bid_price?: string | null;
  ask_price?: string | null;
  last_trade_price?: string | null;
  previous_close?: string | null;
  updated_at?: string | null;
}

/// A book wider than this share of its mid is a stub (after hours BIDU read bid 82, ask 555), not a price.
const MAX_SPREAD = 0.05;

/// One quote from the endpoint's own shape. `undefined` when it has no usable price or time, so a halted or
/// unknown symbol shows a dash instead of a zero.
export function parseReferenceQuote(raw: RawQuote): ReferenceQuote | undefined {
  const bid = Number(raw.bid_price);
  const ask = Number(raw.ask_price);
  const last = Number(raw.last_trade_price);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : undefined;
  const tight = mid !== undefined && (ask - bid) / mid <= MAX_SPREAD;
  const price = tight || (mid !== undefined && !(last > 0)) ? mid : last > 0 ? last : undefined;
  if (price === undefined || !raw.updated_at) return undefined;
  const previous = Number(raw.previous_close);
  return { price, changeBps: previous > 0 ? Math.round((price / previous - 1) * 10_000) : null, asOf: raw.updated_at };
}

/// Quotes for many symbols in one request. A symbol the source does not answer for is absent from the map.
export async function fetchReferenceQuotes(
  symbols: readonly string[],
  options: { url?: string; timeoutMs?: number } = {},
): Promise<Map<string, ReferenceQuote>> {
  const quotes = new Map<string, ReferenceQuote>();
  if (symbols.length === 0) return quotes;
  try {
    const url = `${options.url ?? REFERENCE_QUOTES_URL}?symbols=${symbols.map(encodeURIComponent).join(",")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 6_000) });
    if (!response.ok) return quotes;
    const body = (await response.json()) as { results?: Array<RawQuote | null> };
    for (const raw of body.results ?? []) {
      const quote = raw ? parseReferenceQuote(raw) : undefined;
      if (raw?.symbol && quote) quotes.set(raw.symbol, quote);
    }
  } catch {
    // The source is down or slow: the page shows dashes, and the next poll tries again.
  }
  return quotes;
}
