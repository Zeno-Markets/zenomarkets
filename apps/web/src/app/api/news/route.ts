import { marketForSymbol, marketsForChain, NEWS_FEEDS, ROBINHOOD_MAINNET_CHAIN_ID, tickerFeed, type NewsFeed } from "@zeno/config";
import { buildMatchers, collectNews, isArticleUrl, parseFeed, type NewsItem, type RawItem } from "@/lib/news";

/// Market News: headlines from public publisher RSS feeds, normalised to one shape. No key, no database, no scraping, and
/// nothing is stored beyond a short in-memory copy per feed. Vercel's CDN serves almost every request from the
/// `s-maxage` copy. The in-memory map below is the second layer: it spares the publishers when the CDN asks again, and it
/// answers with the last good copy when a publisher is down.
const FEED_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_BYTES = 2_000_000;
const CDN = "public, s-maxage=300, stale-while-revalidate=900";

const cache = new Map<string, { at: number; items: RawItem[] }>();
/// Feed hosts to skip, comma separated (`NEWS_BLOCKED_HOSTS`). The switch for a publisher that misbehaves, with no deploy.
const blocked = () => new Set((process.env.NEWS_BLOCKED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));

async function load(feed: NewsFeed): Promise<RawItem[]> {
  const hit = cache.get(feed.url);
  if (hit && Date.now() - hit.at < FEED_TTL_MS) return hit.items;
  try {
    if (blocked().has(new URL(feed.url).hostname)) throw new Error("host blocked");
    const response = await fetch(feed.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (compatible; ZenoNews/1.0)", Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("feed too large");
    const parsed = parseFeed(text);
    const items = feed.listedSitesOnly ? parsed.filter((item) => isArticleUrl(item.url)) : parsed;
    cache.set(feed.url, { at: Date.now(), items });
    return items;
  } catch (error) {
    if (hit) return hit.items;
    throw error;
  }
}

/// `GET /api/news` is every category. `GET /api/news?ticker=AAPL` is that market's headlines: its own feed plus the
/// general feeds' headlines that name it. (The per-category cap is lifted here: it would cut a ticker's own headlines behind busier general ones.) The ticker must be a listed market, so a request never chooses a feed address.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase();
  const listings = marketsForChain(ROBINHOOD_MAINNET_CHAIN_ID);
  const listing = raw ? marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, raw) : undefined;
  if (raw && !listing) return Response.json({ error: "unknown ticker" }, { status: 404, headers: { "Cache-Control": CDN } });

  const own = listing ? tickerFeed(listing) : undefined;
  const { items, failed } = await collectNews(own ? [own, ...NEWS_FEEDS] : NEWS_FEEDS, load, buildMatchers(listings), listing ? Infinity : undefined);
  const shown: NewsItem[] = listing ? items.filter((item) => item.tickers.includes(listing.symbol) || item.source === own?.source).map((item) => (item.tickers.includes(listing.symbol) ? item : { ...item, tickers: [listing.symbol, ...item.tickers] })) : items;

  if (items.length === 0) return Response.json({ error: "no feed could be read" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  return Response.json({ items: shown, updatedAt: new Date().toISOString(), failed }, { headers: { "Cache-Control": CDN } });
}
