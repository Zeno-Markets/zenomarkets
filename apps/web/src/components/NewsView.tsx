"use client";

import { Button, Skeleton, Tabs, chip, cn, pill } from "@zeno/ui";
import { logoForSymbol, marketForSymbol, NEWS_CATEGORIES, NEWS_CATEGORY_LABEL, ROBINHOOD_MAINNET_CHAIN_ID, type NewsCategory } from "@zeno/config";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useNow } from "@/hooks/useNow";
import { useOnline } from "@/hooks/useOnline";
import { fmtAgo, fmtClock, groupByDay, initials, trending, type NewsItem } from "@/lib/news";
import { ArrowIcon } from "./ArrowIcon";
import { PanelState } from "./PanelState";

type Tab = "all" | NewsCategory;

const tabs: Array<{ id: Tab; label: string }> = [{ id: "all", label: "All" }, ...NEWS_CATEGORIES.map((id) => ({ id, label: NEWS_CATEGORY_LABEL[id] }))];

/// The page shows this many cards before "Show more".
const PAGE = 18;

interface NewsResponse {
  items: NewsItem[];
  updatedAt: string;
  failed: number;
}

/// Headlines from this app's own `/api/news` route, which the CDN holds for five minutes. A typed symbol that is a listed
/// market asks for that market's own feed as well; anything else only narrows the headlines already loaded.
const newsQuery = (ticker: string) => ({
  queryKey: ["news", ticker],
  queryFn: async (): Promise<NewsResponse> => {
    const response = await fetch(ticker ? `/api/news?ticker=${encodeURIComponent(ticker)}` : "/api/news");
    if (!response.ok) throw new Error("news unavailable");
    return response.json();
  },
  refetchInterval: 5 * 60_000,
  retry: 1,
});

/// A market with a perpetual. A display-only market (PDD, JD) has no terminal to open, so it earns no badge.
const hasPerp = (symbol: string) => marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol)?.tier === "tradeable";

/// The picture of a story. The feed's own image comes first; a story whose feed has none asks `/api/news/thumb` for the
/// preview image of its article page (the CDN holds the answer for a day). With neither, the logo of the first market it
/// names, then the publisher's initials. The box is fixed at 16:9 from the first paint, so no picture arriving, late or
/// not at all, moves anything. Only an https address ever gets here.
function Thumb({ item, className }: { item: NewsItem; className?: string }) {
  const [broken, setBroken] = useState(false);
  const lazy = useQuery({
    queryKey: ["news-thumb", item.url],
    queryFn: async (): Promise<string | null> => {
      const response = await fetch(`/api/news/thumb?url=${encodeURIComponent(item.url)}`);
      return response.ok ? ((await response.json()) as { image: string | null }).image : null;
    },
    enabled: !item.thumbnail,
    staleTime: Infinity,
    retry: 1,
  });
  const picture = item.thumbnail ?? lazy.data ?? undefined;
  const market = item.tickers.find(hasPerp);
  const logo = market ? logoForSymbol(market) : undefined;
  const waiting = !picture && !item.thumbnail && lazy.isPending;
  const shows = picture && !broken ? "picture" : waiting ? "waiting" : logo ? "logo" : "initials";
  return (
    <span data-thumb={shows} className={cn("relative block aspect-[16/9] w-full overflow-hidden bg-raised", className)}>
      {picture && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- publisher images, many hosts, no loader
        <img src={picture} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover" />
      ) : waiting ? (
        <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-raised" />
      ) : logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- market logo from the config, one small image
        <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 rounded-panel bg-ground object-contain p-2" />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center font-display text-[2rem] font-bold tracking-[-0.03em] text-faint">
          {initials(item.source)}
        </span>
      )}
    </span>
  );
}

/// One badge per market the story names that Zeno lists. It opens that market's perpetual in the terminal.
function Badges({ tickers, className }: { tickers: string[]; className?: string }) {
  const shown = tickers.filter(hasPerp).slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((symbol) => (
        <Link key={symbol} href={`/perpetuals?market=${encodeURIComponent(symbol)}`} title={`Open the ${symbol} perpetual`} className={cn(chip, "h-7 gap-1.5 px-2 text-xs font-semibold tracking-[0.02em]")}>
          {symbol}
          <ArrowIcon className="size-2.5" />
        </Link>
      ))}
    </div>
  );
}

function Meta({ item, now }: { item: NewsItem; now: number }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
      <span>{NEWS_CATEGORY_LABEL[item.category]}</span>
      <span aria-hidden="true">·</span>
      <span className="normal-case tracking-normal">{item.source}</span>
      {now ? (
        <>
          <span aria-hidden="true">·</span>
          <time dateTime={item.publishedAt} className="normal-case tracking-normal">
            {fmtAgo(item.publishedAt, now)}
          </time>
        </>
      ) : null}
    </span>
  );
}

/// The top story: a wide card, the headline set large in the display face.
function Lead({ item, now }: { item: NewsItem; now: number }) {
  return (
    <article data-news-card className="overflow-hidden rounded-panel border border-line/70 bg-surface md:grid md:grid-cols-[3fr_2fr]">
      <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (opens ${item.source})`} className="group block md:contents">
        <Thumb item={item} className="md:row-span-2 md:aspect-auto md:h-full md:min-h-72" />
        <span className="flex flex-col gap-3 p-4 pb-2 md:p-8 md:pb-2 md:self-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.28em] text-accent-fg">Top story</span>
          <span className="font-display text-[1.5rem] font-bold leading-[1.12] tracking-[-0.03em] group-hover:underline group-hover:underline-offset-4 sm:text-[2rem]">{item.title}</span>
          <Meta item={item} now={now} />
        </span>
      </a>
      <Badges tickers={item.tickers} className="px-4 pb-4 md:px-8 md:pb-8 md:self-start" />
    </article>
  );
}

function Card({ item, now }: { item: NewsItem; now: number }) {
  return (
    <li className="flex">
      <article data-news-card className="flex w-full flex-col overflow-hidden rounded-panel border border-line/70 bg-surface transition-colors duration-150 hover:border-accent-line">
        <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} (opens ${item.source})`} className="group flex flex-1 flex-col">
          <Thumb item={item} />
          <span className="flex flex-1 flex-col gap-2 p-4 pb-2">
            <Meta item={item} now={now} />
            <span className="line-clamp-4 font-display text-lg font-semibold leading-snug tracking-[-0.02em] group-hover:underline group-hover:underline-offset-4">{item.title}</span>
          </span>
        </a>
        <Badges tickers={item.tickers} className="px-4 pb-4 pt-1" />
      </article>
    </li>
  );
}

function Skeletons() {
  return (
    <div aria-busy="true" aria-label="Loading the news" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-panel border border-line/70 bg-surface">
          <Skeleton className="block aspect-[16/9] w-full rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="w-1/2" />
            <Skeleton className="w-full" />
            <Skeleton className="w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/// The seven states: loading (skeleton cards), empty (nothing in this category or for this ticker), error (what happened,
/// and Try again), success, stale (the last good list stays, with the time it is from), offline, and not-connected, which does
/// not apply: this page is public and needs no wallet.
export function NewsView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(NEWS_CATEGORIES.includes(params.get("category") as NewsCategory) ? (params.get("category") as NewsCategory) : "all");
  const [filter, setFilter] = useState(params.get("ticker")?.toUpperCase() ?? "");
  const [shown, setShown] = useState(PAGE);
  const online = useOnline();
  const now = useNow();

  const symbol = filter.trim().toUpperCase();
  const asked = symbol && marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol) ? symbol : "";
  const news = useQuery(newsQuery(asked));
  const inTab = (news.data?.items ?? []).filter((item) => tab === "all" || item.category === tab);
  const items = symbol ? inTab.filter((item) => item.tickers.some((ticker) => ticker.includes(symbol))) : inTab;
  const [lead, ...rest] = items;
  const days = groupByDay(rest.slice(0, shown), now || Date.now());
  const hot = trending(inTab, hasPerp);

  const retry = (
    <Button size="sm" onClick={() => void news.refetch()}>
      Try again
    </Button>
  );
  const narrow = (next: string) => {
    setFilter(next);
    setShown(PAGE);
  };

  return (
    <div className="mt-8 flex flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Tabs
          label="News categories"
          tabs={tabs}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setShown(PAGE);
          }}
        />
        <div className="flex items-center gap-3">
          {news.data ? <p className="hidden text-xs text-muted sm:block">Updated {fmtClock(news.data.updatedAt)}</p> : null}
          <input
            type="search"
            aria-label="Filter by ticker"
            placeholder="Filter by ticker"
            value={filter}
            onChange={(event) => narrow(event.target.value)}
            className="h-8 w-full min-w-0 rounded-md border border-line bg-ground px-2 text-sm placeholder:text-faint hover:border-accent-line focus:border-accent-fg sm:w-44"
          />
        </div>
      </div>

      {hot.length > 0 ? (
        <div role="group" aria-label="Most mentioned markets" className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted">Trending</span>
          {hot.map((entry) => (
            <button key={entry.symbol} type="button" aria-pressed={symbol === entry.symbol} onClick={() => narrow(symbol === entry.symbol ? "" : entry.symbol)} className={cn(pill(symbol === entry.symbol), "h-8 gap-1.5 px-2.5 text-xs")}>
              {entry.symbol}
              <span className="font-normal opacity-70">{entry.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      {news.data && (news.isError || !online) ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-raised px-3 py-1 text-xs text-muted">
          <p>{online ? `Showing news from ${fmtClock(news.data.updatedAt)}. The refresh failed, so this list may be old.` : `You are offline. Showing news from ${fmtClock(news.data.updatedAt)}.`}</p>
          {online ? retry : null}
        </div>
      ) : null}

      {!online && !news.data ? (
        <PanelState action={retry}>You are offline, so the news cannot load. It will refresh by itself when you reconnect.</PanelState>
      ) : news.isPending ? (
        <Skeletons />
      ) : news.isError && !news.data ? (
        <PanelState action={retry}>The news feeds did not answer, so there is nothing to show. Nothing is wrong with your account. Try again in a moment.</PanelState>
      ) : !lead ? (
        <PanelState>{symbol ? `No headline names ${symbol}${tab === "all" ? "" : ` in ${NEWS_CATEGORY_LABEL[tab]}`} right now.` : tab === "all" ? "No headlines right now." : `No ${NEWS_CATEGORY_LABEL[tab]} headlines right now.`}</PanelState>
      ) : (
        <>
          <Lead item={lead} now={now} />
          {days.map((day) => (
            <section key={day.label} aria-label={day.label} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.28em] text-muted">
                {day.label}
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
              </h2>
              <ul aria-label={`Headlines, ${day.label}`} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {day.items.map((item) => (
                  <Card key={item.id} item={item} now={now} />
                ))}
              </ul>
            </section>
          ))}
          {rest.length > shown ? (
            <div className="flex justify-center pt-2">
              <Button onClick={() => setShown((count) => count + PAGE)}>Show more ({rest.length - shown} more)</Button>
            </div>
          ) : null}
        </>
      )}

      <p className="max-w-prose text-xs leading-snug text-muted">
        Headlines come from the publishers' public RSS feeds and refresh every five minutes. Each story links to the publisher's own page; Zeno does not copy articles. Headlines are information, not advice.
      </p>
    </div>
  );
}
