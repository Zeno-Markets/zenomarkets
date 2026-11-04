import { marketsForChain, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { fetchReferenceQuotes } from "@zeno/sdk";

/// Reference prices for the Markets page's display-only rows (the names with no feed: most of the China group and seven US stocks). Served from the web
/// app itself, so they read the same on Testnet and on Mainnet and do not depend on either network's API. The
/// symbols come from the market list, never from the request. The tradeable markets are included too: while an
/// equity session is shut the chain has no price for them, and the page shows the last close from here instead
/// (a symbol the source does not know, such as BTC, is simply absent).
export async function GET() {
  const symbols = marketsForChain(ROBINHOOD_MAINNET_CHAIN_ID).map((market) => market.symbol);
  const quotes = await fetchReferenceQuotes(symbols);
  return Response.json(Object.fromEntries(quotes), { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
