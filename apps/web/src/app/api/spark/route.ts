import { marketsForChain, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";

/// Five days of hourly closes, the last price and the change on the day for every tradeable market, from Yahoo
/// Finance's public chart endpoint (the source the API already uses for chart history). Display only: the landing
/// page's cards and sparklines read it, nothing that moves money does. The symbols come from the market list,
/// never from the request.
export interface Spark {
  price: number;
  changePct: number;
  closes: number[];
}

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
let cache: { at: number; body: Record<string, Spark> } | undefined;

async function one(symbol: string, ticker: string): Promise<[string, Spark] | undefined> {
  try {
    const response = await fetch(`${YAHOO}/${encodeURIComponent(ticker)}?interval=60m&range=5d`, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number }; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
    const result = body.chart?.result?.[0];
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((value): value is number => typeof value === "number" && value > 0);
    const price = result?.meta?.regularMarketPrice;
    if (!price || closes.length < 8) return undefined;
    // The day's change: against the close before the last session (24 hourly bars back for 24/7 markets).
    const previous = result?.meta?.previousClose ?? closes[Math.max(0, closes.length - 25)]!;
    return [symbol, { price, changePct: (price / previous - 1) * 100, closes: closes.slice(-60) }];
  } catch {
    return undefined;
  }
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 120_000) {
    const markets = marketsForChain(ROBINHOOD_MAINNET_CHAIN_ID).filter((market) => market.tier === "tradeable");
    const rows = await Promise.all(markets.map((market) => one(market.symbol, market.historySymbol ?? market.symbol)));
    const body = Object.fromEntries(rows.filter((row): row is [string, Spark] => row !== undefined));
    if (Object.keys(body).length > 0) cache = { at: Date.now(), body };
  }
  return Response.json(cache?.body ?? {}, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
}
