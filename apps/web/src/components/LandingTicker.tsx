"use client";

import { Num, toneOf } from "@zeno/ui";
import Link from "next/link";
import { usePerpMarket, usePerpMarkets, useReferenceQuotes } from "@/hooks/queries";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { Change, fmtChange, useStatsFor } from "./Change";

/// A run should be wider than a wide screen so the loop never shows a gap; short lists repeat.
const MIN_ITEMS_PER_RUN = 8;

function Item({ symbol, hidden }: { symbol: string; hidden: boolean }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  // While the session is shut the chain has no price: show the last close, as the Markets page does.
  const quote = useReferenceQuotes().data?.[symbol];
  return (
    <li>
      <Link
        href={`/perpetuals?market=${symbol}`}
        tabIndex={hidden ? -1 : undefined}
        className="flex h-9 items-center gap-3 rounded-control px-3 transition-colors duration-150 hover:bg-accent-soft hover:text-accent-fg active:bg-accent active:text-accent-ink"
      >
        <span className="font-medium">{symbol}</span>
        {data ? (
          <Num tone="muted">{`$${fmtPrice(data.markPrice)}`}</Num>
        ) : quote ? (
          <Num tone="muted">{`$${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Num>
        ) : null}
        {data && stats ? <Change stats={stats} /> : quote?.changeBps != null ? <Num tone={toneOf(quote.changeBps)}>{fmtChange(quote.changeBps)}</Num> : stats ? <Change stats={stats} /> : null}
      </Link>
    </li>
  );
}

function Run({ symbols, hidden }: { symbols: string[]; hidden: boolean }) {
  return (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-4 pr-4">
      {symbols.map((symbol, index) => (
        <Item key={`${symbol}-${index}`} symbol={symbol} hidden={hidden} />
      ))}
    </ul>
  );
}

/// Every perpetual market with its price and 24h change, sliding past above the header on every page
/// (see `AppShell`) — a shortcut into the terminal that is always on screen, not a landing-only
/// flourish. Sized as a thin strip, not the terminal's own row height, since it now sits over app
/// pages where vertical space is scarce, not just the landing page's own open hero.
export function LandingTicker() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  const run = symbols.length === 0 ? [] : Array.from({ length: Math.ceil(MIN_ITEMS_PER_RUN / symbols.length) }, () => symbols).flat();
  // With nothing listed (or the registry unreadable) the strip would only announce an empty venue above
  // every page, so it is not rendered; the Markets page says it, with a reason, where it matters.
  if (run.length === 0 && !isPending) return null;
  return (
    <div className="ticker flex h-11 shrink-0 items-center overflow-hidden border-b border-line bg-ground text-sm" aria-label="Perpetual markets">
      {run.length === 0 ? (
        <p className="px-4 text-muted sm:px-6 lg:px-[32px]">Loading markets…</p>
      ) : (
        <div className="ticker-track flex w-max items-center">
          <Run symbols={run} hidden={false} />
          <Run symbols={run} hidden />
        </div>
      )}
    </div>
  );
}
