"use client";

import { Num, Skeleton, Stat, chip, cn, fieldBorder, toneOf } from "@zeno/ui";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useNow } from "@/hooks/useNow";
import { usePerpMarket, usePerpMarketConfig, usePerpMarkets, useReferenceQuotes } from "@/hooks/queries";
import { fmtBps, fmtCountdown, fmtPrice } from "@/lib/format";
import { symbolOf, tradeBlocker } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { useWatchlist } from "@/stores/watchlist";
import { Change, fmtChange, useStatsFor } from "./Change";
import { Term } from "./Term";

/// The watchlist star in the palette's gold: an outline when the market is not pinned, filled when it is.
function Star({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="mr-1 size-4 text-gold" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" />
    </svg>
  );
}

/// The market's identity and the one number that matters most, the mark price, set large. Under
/// 1280px the market list is not on screen, so a picker here takes its place.
export function MarketHeader() {
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { data, isPending } = usePerpMarket(symbol);
  const { data: markets } = usePerpMarkets();
  const stats = useStatsFor(symbol);
  const now = useNow();
  const { symbols: watched, ready, load, toggle } = useWatchlist();
  useEffect(load, [load]);
  const watching = watched.includes(symbol);

  const paused = tradeBlocker(usePerpMarketConfig(symbol)?.active);
  // The read failed for good (a stale feed, usually): say so with a dash, not a placeholder that never fills.
  const unpriced = Boolean(symbol) && !data && !isPending;
  // The last close from Robinhood, shown while the equity session is shut and the chain has no price.
  const close = useReferenceQuotes().data?.[symbol];
  const figure = (node: ReactNode, width: string) => (data ? node : unpriced ? "–" : <Skeleton className={width} />);

  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-panel border border-line/70 bg-surface p-3 lg:flex-row lg:items-center lg:gap-8 lg:px-4">
      <div className="flex items-center justify-between gap-3 xl:block">
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-title font-semibold">{symbol ? `${symbol}-PERP` : "–"}</h1>
          {paused ? (
            <span className="rounded-sm border border-down px-1 text-xs text-down" title={paused}>
              Paused
            </span>
          ) : unpriced ? (
            <span className="rounded-sm border border-line px-1 text-xs text-muted" title="This market has no fresh price, so it cannot be traded until its feed updates.">
              {close ? "Market closed" : "No price"}
            </span>
          ) : null}
        </div>
        {markets && markets.length > 1 ? (
          <label className="xl:hidden">
            <span className="sr-only">Market</span>
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className={cn(fieldBorder, "h-9 rounded-md border bg-raised px-2 text-sm hover:bg-accent-soft")}
            >
              {markets.map((market) => {
                const value = symbolOf(market.marketId);
                return (
                  <option key={market.marketId} value={value}>
                    {value}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-baseline gap-3">
        {unpriced && close ? (
          <>
            <Num className="font-display text-figure font-semibold">{close.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Num>
            <span className="text-xs text-muted">last close</span>
            {close.changeBps !== null ? <Num tone={toneOf(close.changeBps)} className="text-sm">{fmtChange(close.changeBps)}</Num> : null}
          </>
        ) : (
          <>
            <Num className="font-display text-figure font-semibold">{figure(data && fmtPrice(data.markPrice), "h-7 w-32")}</Num>
            <Change stats={stats} className="text-sm" />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:flex-1">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-5 xl:gap-x-4">
          <Stat label="Index price">{figure(data && fmtPrice(data.indexPrice), "w-14")}</Stat>
          <Stat label={<Term term="fundingRate">Funding rate</Term>}>{figure(data && fmtBps(data.funding.currentFundingRateBps), "w-14")}</Stat>
          <Stat label="Next funding">{data && now ? fmtCountdown(data.funding.nextFundingTimestamp, now) : figure(undefined, "w-14")}</Stat>
          <Stat label="Max leverage">{figure(data && `${data.risk.maxLeverage}x`, "w-10")}</Stat>
        </dl>
        {symbol && ready ? (
          <button type="button" onClick={() => toggle(symbol)} className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
            <Star filled={watching} />
            {watching ? "Remove from watchlist" : "Add to watchlist"}
          </button>
        ) : null}
        {symbol ? (
          <Link href={`/alerts?symbol=${encodeURIComponent(symbol)}`} className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
            Set alert
          </Link>
        ) : null}
        {symbol ? (
          <Link href={`/news?ticker=${encodeURIComponent(symbol)}`} className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
            News
          </Link>
        ) : null}
      </div>
    </div>
  );
}
