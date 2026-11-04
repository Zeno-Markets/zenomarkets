import type { MarketGroup } from "@zeno/types";
import type { MarketListing } from "./markets.js";

/// The Market News page: which publisher feeds are read, how a feed or a market group maps to a news category, and
/// how a ticker finds its own feed. Every URL here was fetched and returned items on 2026-10-14. A feed that dies is
/// dropped from this list, and the page keeps working on the rest.
///
/// A feed is kept only if every one of its stories can have a picture: from the feed itself, or from the article page on a site
/// in `NEWS_ARTICLE_DOMAINS`. Four were dropped for that: Nasdaq (no image field, and its pages answer a bot with 403),
/// ETF Database (its pages answer Node's fetch with 403) MarketWatch's Market Pulse (no image field, pages block a bot) and Investing.com (an image on only some stories, pages block a bot).

export const NEWS_CATEGORIES = ["stocks", "china", "crypto", "etf", "commodities"] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export const NEWS_CATEGORY_LABEL: Record<NewsCategory, string> = {
  stocks: "US Stocks",
  china: "China",
  crypto: "Crypto",
  etf: "ETF",
  commodities: "Commodities",
};

/// A market group's news category.
export function categoryForGroup(group: MarketGroup): NewsCategory | undefined {
  return group === "us-equities" ? "stocks" : group;
}

export interface NewsFeed {
  /// Shown on every row. The publisher, never Zeno.
  source: string;
  url: string;
  category: NewsCategory;
  /// The feed links to many sites (Yahoo Finance syndicates 247wallst, StockTwits and others). Only the stories on a site in
  /// `NEWS_ARTICLE_DOMAINS` are kept, because only those can be given a picture.
  listedSitesOnly?: boolean;
}

export const NEWS_FEEDS: readonly NewsFeed[] = [
  { source: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "stocks" },
  { source: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069", category: "stocks" },
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", category: "stocks" },
  { source: "South China Morning Post", url: "https://www.scmp.com/rss/92/feed", category: "china" },
  { source: "CNBC Asia", url: "https://www.cnbc.com/id/19832390/device/rss/rss.html", category: "china" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "crypto" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss", category: "crypto" },
  { source: "Decrypt", url: "https://decrypt.co/feed", category: "crypto" },
  { source: "ETF Trends", url: "https://www.etftrends.com/feed/", category: "etf" },
  ...(["SPY", "QQQ"] as const).flatMap((symbol) => tickerFeed({ symbol, group: "etf" }) ?? []),
  { source: "OilPrice.com", url: "https://oilprice.com/rss/main", category: "commodities" },
  { source: "CNBC Energy", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19836768", category: "commodities" },
];

/// A ticker's own feed: Yahoo Finance's headline feed, keyed by the listing's `historySymbol` when it has one
/// (`BTC` is a fund on the stock exchanges, the coin is `BTC-USD`) and by the symbol otherwise.
export function tickerFeed(listing: Pick<MarketListing, "symbol" | "historySymbol" | "group">): NewsFeed | undefined {
  const category = categoryForGroup(listing.group);
  if (!category) return undefined;
  const key = encodeURIComponent(listing.historySymbol ?? listing.symbol);
  return { source: "Yahoo Finance", url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${key}&region=US&lang=en-US`, category, listedSitesOnly: true };
}

/// Words a headline uses for a market besides its ticker. The first word of the listing's name is tried as well
/// (Apple, Tesla, Bitcoin), unless it is in `NEWS_NAME_STOPWORDS`.
export const NEWS_NAME_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ETH: ["Ethereum"],
  GOOGL: ["Google"],
};

/// First words of listing names that are ordinary English or a fund family, so they would tag unrelated headlines.
export const NEWS_NAME_STOPWORDS: ReadonlySet<string> = new Set(["strategy", "united", "space", "circle", "silicon", "rocket", "taiwan", "invesco", "ishares", "spdr", "usa"]);

/// Sites whose article pages the thumbnail route may open to read the page's own preview image (its `og:image`). A story
/// link on any other site never gets fetched. A host matches when it is one of these or a subdomain of one.
export const NEWS_ARTICLE_DOMAINS: readonly string[] = [
  "cnbc.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "scmp.com",
  "coindesk.com",
  "cointelegraph.com",
  "decrypt.co",
  "etftrends.com",
  "oilprice.com",
];
