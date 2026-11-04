import { zenoRead } from "./zeno";

/// The first of `symbols` (in order) that has an index price right now, or the first one when none has. At the
/// weekend the equities are closed and answer `MarketSessionClosed`, so a terminal that opens on the first listed
/// market would open on one with no price.
export async function firstPriced(symbols: readonly string[]): Promise<string> {
  const results = await Promise.allSettled(symbols.map((symbol) => zenoRead.oracle.getIndexPrice(symbol)));
  return symbols.find((_, i) => results[i]?.status === "fulfilled") ?? symbols[0]!;
}
