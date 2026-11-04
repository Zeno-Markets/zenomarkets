import { marketForSymbol, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { hexToString, parseUnits } from "viem";

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; price: bigint | undefined }>();

/// The market's symbol from its bytes32 id ("NVDA" right-padded with zero bytes).
export function symbolOf(marketId: `0x${string}`): string {
  return hexToString(marketId, { size: 32 }).replace(/\0+$/, "");
}

/// The last traded price of the market's real instrument, 18 decimals, from Yahoo Finance's public chart endpoint
/// (the same source the API uses for chart history). Undefined when the quote cannot be read; the keeper then only
/// keeps the feed alive. Testnet only: nothing on mainnet reads this.
export async function referencePrice(marketId: `0x${string}`, fetcher: typeof fetch = fetch): Promise<bigint | undefined> {
  const symbol = symbolOf(marketId);
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.price;
  const ticker = marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol)?.historySymbol ?? symbol;
  let price: bigint | undefined;
  try {
    const response = await fetcher(`${YAHOO_URL}/${encodeURIComponent(ticker)}?interval=1m&range=1d`, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "Mozilla/5.0" } });
    const body = (await response.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
    const last = body.chart?.result?.[0]?.meta?.regularMarketPrice;
    price = typeof last === "number" && last > 0 ? parseUnits(last.toFixed(8), 18) : undefined;
  } catch {
    price = undefined;
  }
  cache.set(symbol, { at: Date.now(), price });
  return price;
}
