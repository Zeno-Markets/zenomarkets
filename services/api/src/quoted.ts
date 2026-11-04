import { marketsForTier, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { fetchReferenceQuotes } from "@zeno/sdk";

/// Tier 2 of the listing model (`REFERENCE.md` Section 2): a display price for a stock that has no Chainlink
/// feed. It comes from Robinhood's public quote endpoint, never reaches `ZenoPriceValidator`, and carries its source
/// and age so the page can say both. The same rows show on every network, because the price is the real stock's.
/// Some rows (the China names such as PDD and JD) have no token on this chain, so `token` can be null.

const CACHE_TTL_MS = 30_000;

export interface QuotedRow {
  symbol: string;
  name: string;
  group: string;
  tier: "quoted";
  token: string | null;
  /// Mid of bid and ask in USD, or null when the source did not answer.
  price: number | null;
  /// Change from the previous close in basis points, or null.
  changeBps: number | null;
  source: "Robinhood reference price";
  /// ISO time the source generated the quote, or null.
  asOf: string | null;
}

let cache: { at: number; rows: QuotedRow[] } | undefined;

export async function quotedRows(now = Date.now()): Promise<QuotedRow[]> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows;
  const listings = marketsForTier(ROBINHOOD_MAINNET_CHAIN_ID, "quoted");
  const quotes = await fetchReferenceQuotes(
    listings.map((listing) => listing.symbol),
    process.env.QUOTE_API_URL ? { url: process.env.QUOTE_API_URL } : {},
  );
  const rows = listings.map((listing): QuotedRow => {
    const q = quotes.get(listing.symbol);
    return {
      symbol: listing.symbol,
      name: listing.name,
      group: listing.group,
      tier: "quoted",
      token: listing.token ?? null,
      price: q?.price ?? null,
      changeBps: q?.changeBps ?? null,
      source: "Robinhood reference price",
      asOf: q?.asOf ?? null,
    };
  });
  cache = { at: now, rows };
  return rows;
}
