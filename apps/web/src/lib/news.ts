import { NEWS_ARTICLE_DOMAINS, NEWS_NAME_ALIASES, NEWS_NAME_STOPWORDS, type MarketListing, type NewsCategory, type NewsFeed } from "@zeno/config";

/// Market News, the pure half: RSS/Atom parsing, de-duplication and ticker matching. The route handler fetches,
/// this file only reads text. A headline is kept as plain text and a link; article bodies are never copied.

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  /// ISO 8601.
  publishedAt: string;
  /// https only.
  thumbnail?: string;
  category: NewsCategory;
  tickers: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/// Plain text from a feed field: CDATA unwrapped, tags removed, entities decoded, whitespace collapsed.
export function plainText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const decode = (text: string) =>
    text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const point = code[1]!.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    });
  // Decode, strip tags, decode again: a feed may escape its markup (`&lt;p&gt;`), and that must not reach the page as a tag.
  return decode(decode(unwrapped).replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const field = (block: string, tag: string) => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match ? match[1]! : undefined;
};

const attr = (tagText: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tagText)?.slice(1, 3).find((value) => value !== undefined);

/// An http(s) address, or undefined. Anything else (`javascript:`, `data:`) never becomes a link.
export function safeUrl(raw: string | undefined, httpsOnly = false): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(plainText(raw));
    return url.protocol === "https:" || (!httpsOnly && url.protocol === "http:") ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function thumbnailOf(block: string): string | undefined {
  for (const tag of block.match(/<(?:media:thumbnail|media:content|enclosure)\b[^>]*>/gi) ?? []) {
    const type = attr(tag, "type") ?? "";
    const medium = attr(tag, "medium") ?? "";
    const url = attr(tag, "url");
    const looksLikeImage = /^<media:thumbnail/i.test(tag) || medium === "image" || type.startsWith("image/") || /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(url ?? "");
    const safe = looksLikeImage ? safeUrl(url, true) : undefined;
    if (safe) return safe;
  }
  // Last resort: the first image in the description. Only its address is read; the markup itself is dropped.
  const inline = /<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(plainTextKeepingTags(field(block, "description") ?? field(block, "content:encoded") ?? ""));
  return safeUrl(inline?.[1], true);
}

/// Escaped markup (`&lt;img ...&gt;`) turned back into tags, only so an image address can be found in it.
const plainTextKeepingTags = (raw: string) => raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/// 32-bit FNV-1a of the address, in hex: a stable key for a row, not a security hash.
export function hashId(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export type RawItem = Pick<NewsItem, "title" | "url" | "publishedAt" | "thumbnail">;

/// The items of an RSS 2.0 or Atom document. An item with no title, no http(s) link or no readable date is skipped.
export function parseFeed(xml: string): RawItem[] {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const items: RawItem[] = [];
  for (const block of blocks) {
    const title = plainText(field(block, "title") ?? "");
    const atomLink = (block.match(/<link\b[^>]*>/gi) ?? []).find((tag) => (attr(tag, "rel") ?? "alternate") === "alternate" && attr(tag, "href"));
    const url = safeUrl(field(block, "link") ?? (atomLink ? attr(atomLink, "href") : undefined));
    const date = new Date(plainText(field(block, "pubDate") ?? field(block, "published") ?? field(block, "updated") ?? field(block, "dc:date") ?? ""));
    if (!title || !url || Number.isNaN(date.getTime())) continue;
    const thumbnail = thumbnailOf(block);
    items.push({ title, url, publishedAt: date.toISOString(), ...(thumbnail ? { thumbnail } : {}) });
  }
  return items;
}

/// Two addresses are one article when they differ only in host case, query or fragment (`?utm_source=`, `?.tsrc=rss`).
const urlKey = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
};
const titleKey = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/// Newest first, and one row per address and per headline: the first (newest) one wins.
export function dedupe(items: readonly NewsItem[]): NewsItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const kept: NewsItem[] = [];
  for (const item of [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const byUrl = urlKey(item.url);
    const byTitle = titleKey(item.title);
    if (seenUrls.has(byUrl) || (byTitle && seenTitles.has(byTitle))) continue;
    seenUrls.add(byUrl);
    seenTitles.add(byTitle);
    kept.push(item);
  }
  return kept;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()[\]\\]/g, "\\$&");

export interface Matcher {
  symbol: string;
  /// The ticker itself, case-sensitive.
  exact: RegExp;
  /// The name words, any case.
  names?: RegExp;
}

/// One matcher per listed market. The symbol must match in capitals as a whole word. A symbol of one or two letters (LI, JD, MU,
/// WB) is common in ordinary words and initials, so it counts only as `$JD`, `(JD)` or `NYSE:JD`. The first word of the name
/// (Apple, Bitcoin) and the aliases in `@zeno/config` match in any case, as whole words.
export function buildMatchers(listings: readonly MarketListing[]): Matcher[] {
  return listings.map((listing) => {
    const symbol = escapeRegex(listing.symbol);
    const exact = new RegExp(
      listing.symbol.length <= 2 ? `(?:\\$|\\(|(?:NYSE|NASDAQ|NYSEARCA|HKEX|SEHK)\\s?:\\s?)${symbol}(?![A-Za-z0-9])` : `(?<![A-Za-z0-9$])\\$?${symbol}(?![A-Za-z0-9])`,
    );
    const words: string[] = [...(NEWS_NAME_ALIASES[listing.symbol] ?? [])];
    const first = listing.name.split(" • ")[0]!.split(/\s+/)[0]!;
    if (first.length >= 4 && !NEWS_NAME_STOPWORDS.has(first.toLowerCase())) words.push(first);
    return { symbol: listing.symbol, exact, ...(words.length ? { names: new RegExp(`(?<![A-Za-z0-9])(?:${words.map(escapeRegex).join("|")})(?![A-Za-z0-9])`, "i") } : {}) };
  });
}

/// The listed symbols a headline is about, in listing order.
export function matchTickers(title: string, matchers: readonly Matcher[]): string[] {
  return matchers.filter((matcher) => matcher.exact.test(title) || matcher.names?.test(title)).map((matcher) => matcher.symbol);
}

/// A feed's raw items as rows: the feed's own source and category, the tickers its headlines name.
export function toItems(feed: NewsFeed, raw: readonly RawItem[], matchers: readonly Matcher[]): NewsItem[] {
  return raw.map((item) => ({ id: hashId(item.url), ...item, source: feed.source, category: feed.category, tickers: matchTickers(item.title, matchers) }));
}

export interface Collected {
  items: NewsItem[];
  /// Feeds that could not be read. The rest still count.
  failed: number;
}

/// Reads every feed at once. A feed that throws costs its own rows and nothing else.
export async function collectNews(feeds: readonly NewsFeed[], load: (feed: NewsFeed) => Promise<RawItem[]>, matchers: readonly Matcher[], perCategory = 40): Promise<Collected> {
  const results = await Promise.allSettled(feeds.map(async (feed) => toItems(feed, await load(feed), matchers)));
  return {
    // A cap per category, so a busy one (crypto) cannot push a quiet one (China) off the page.
    items: dedupe(results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))).filter((item, _index, all) => all.filter((other) => other.category === item.category && other.publishedAt > item.publishedAt).length < perCategory),
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

/// "just now", "5 min ago", "3 h ago", "2 d ago". A date in the future (a clock off by a minute) reads as "just now".
export function fmtAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}

/// "Today", "Yesterday", or "Mon, Oct 12", by the reader's own calendar.
export function dayLabel(iso: string, now: number): string {
  const date = new Date(iso);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/// Rows in the order given, grouped under their day. A day is a new group only when it changes, so a feed that is not
/// perfectly sorted never splits one day into two.
export function groupByDay<T extends { publishedAt: string }>(items: readonly T[], now: number): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.publishedAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/// Up to three capitals for a source with no picture: "South China Morning Post" is SCM, "CNBC" is C.
export function initials(source: string): string {
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length === 1 ? words[0]!.slice(0, 1) : words.slice(0, 3).map((word) => word[0]).join("")).toUpperCase();
}

/// The symbols most named across the headlines, most first, ties in alphabetical order. `keep` limits it to symbols worth showing.
export function trending(items: readonly Pick<NewsItem, "tickers">[], keep: (symbol: string) => boolean, limit = 8): Array<{ symbol: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) for (const symbol of item.tickers) if (keep(symbol)) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  return [...counts].map(([symbol, count]) => ({ symbol, count })).sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol)).slice(0, limit);
}

/// Whether an article address may be opened to read its preview image: https, on a site in `NEWS_ARTICLE_DOMAINS`.
export function isArticleUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && NEWS_ARTICLE_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const PREVIEW_KEYS = ["og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src", "parsely-image-url"];

/// The preview image an article page names in its `<head>` (`og:image`, else `twitter:image`), as an https address, or undefined.
/// Only these meta tags are read; nothing of the article's text is.
export function findPreviewImage(html: string, pageUrl: string): string | undefined {
  const found = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && PREVIEW_KEYS.includes(key) && !found.has(key)) found.set(key, content);
  }
  for (const key of PREVIEW_KEYS) {
    const content = found.get(key);
    if (!content) continue;
    try {
      const safe = safeUrl(new URL(plainText(content), pageUrl).toString(), true);
      if (safe) return safe;
    } catch {
      // A content value that is not an address: try the next key.
    }
  }
  return undefined;
}

/// A time of day in US Eastern time, the market's clock, whatever the reader's own: "09:47 EDT" in summer, "09:47 EST" in winter.
export function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
}
