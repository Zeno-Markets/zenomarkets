import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { StringDecoder } from "node:string_decoder";
import { findPreviewImage, isArticleUrl } from "@/lib/news";

/// The picture of a story whose feed carries none (CNBC and Yahoo Finance headlines have no image field). It opens the
/// article's own page, reads the preview image its `<head>` names (the same `og:image` a chat app uses for a link card)
/// and returns that address. Nothing of the page is kept or shown. Only sites in `NEWS_ARTICLE_DOMAINS` are opened, only
/// over https, and a redirect to any other site stops the read. The CDN holds an answer for a day; the in-memory map
/// spares the publisher when it asks again.
const FOUND_TTL_MS = 24 * 3_600_000;
const MISSING_TTL_MS = 3_600_000;
const REQUEST_TIMEOUT_MS = 5_000;
/// A page header can be long (CoinDesk's is over 200 KB of inline script before the meta tags end), so the cap is generous; the read
/// stops at the first preview image or at `</head>`, whichever comes first.
const MAX_HEAD_BYTES = 900_000;
const MAX_REDIRECTS = 3;
const CDN = "public, s-maxage=86400, stale-while-revalidate=604800";

const cache = new Map<string, { at: number; image: string | null }>();

/// `node:https`, not `fetch`: Yahoo Finance answers with more than 16 KB of headers, which `fetch` refuses ("Headers Overflow").
/// No `Accept` header on purpose, and no `Accept-Encoding`, so the page comes back as plain text.
function open(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ZenoNews/1.0)" }, maxHeaderSize: 262_144, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/// Reads a page only as far as its preview image, its `</head>` or the size cap, so an article is never read whole.
async function readPreview(page: IncomingMessage, pageUrl: string): Promise<string | undefined> {
  const decoder = new StringDecoder("utf8");
  let text = "";
  let image: string | undefined;
  for await (const chunk of page) {
    text += decoder.write(chunk as Buffer);
    image = findPreviewImage(text, pageUrl);
    if (image || text.length >= MAX_HEAD_BYTES || /<\/head>/i.test(text)) break;
  }
  page.destroy();
  return image;
}

async function resolve(url: string): Promise<string | null> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isArticleUrl(target)) return null;
    const page = await open(target);
    const status = page.statusCode ?? 0;
    const next = page.headers.location;
    if (status >= 300 && status < 400 && next) {
      page.destroy();
      target = new URL(next, target).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      page.destroy();
      return null;
    }
    return (await readPreview(page, target)) ?? null;
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url") ?? "";
  if (!isArticleUrl(url)) return Response.json({ error: "not a news article address" }, { status: 400, headers: { "Cache-Control": "public, s-maxage=3600" } });
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.image ? FOUND_TTL_MS : MISSING_TTL_MS)) return Response.json({ image: hit.image }, { headers: { "Cache-Control": CDN } });
  try {
    const image = await resolve(url);
    if (cache.size > 2_000) cache.clear();
    cache.set(url, { at: Date.now(), image });
    return Response.json({ image }, { headers: { "Cache-Control": image ? CDN : "public, s-maxage=3600" } });
  } catch {
    // The publisher did not answer: say "no picture" for now, and let the next request try again.
    return Response.json({ image: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
