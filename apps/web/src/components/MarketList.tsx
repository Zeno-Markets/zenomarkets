"use client";

import { Num, Panel, Skeleton, cn, menuItem, toneOf } from "@zeno/ui";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { usePerpMarket, usePerpMarketConfig, usePerpMarkets, useReferenceQuotes } from "@/hooks/queries";
import { fmtBps, fmtPrice } from "@/lib/format";
import { firstPriced } from "@/lib/pricedDefault";
import { env } from "@/lib/env";
import { groupTabs, inGroup, symbolOf, tradeBlocker, type GroupTab } from "@/lib/market";
import { groupForSymbol } from "@zeno/config";
import { useTerminal } from "@/stores/terminal";
import { Change, fmtChange, useStatsFor } from "./Change";
import { NONE } from "./None";

/// Enough markets that finding one by eye is slower than typing part of its name.
const FILTER_FROM = 6;

function MarketRow({ symbol }: { symbol: string }) {
  const selected = useTerminal((state) => state.symbol === symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { data, isPending } = usePerpMarket(symbol);
  const config = usePerpMarketConfig(symbol);
  const stats = useStatsFor(symbol);
  const close = useReferenceQuotes().data?.[symbol];
  const closed = !data && !isPending && close !== undefined;

  return (
    <li>
      <button
        type="button"
        onClick={() => setSymbol(symbol)}
        aria-pressed={selected}
        className={cn(
          "grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 border-l-[3px] px-3 py-2 text-left transition-colors duration-150",
          selected
            ? "border-accent-fg bg-accent-soft"
            : "border-transparent bg-transparent hover:border-accent-line hover:bg-accent-soft active:border-accent-fg active:bg-accent-soft",
        )}
      >
        <span className="flex items-baseline gap-1.5 font-medium">
          {symbol}
          {tradeBlocker(config?.active) ? (
            <span className="rounded-sm border border-down px-1 text-[10px] font-normal text-down">Paused</span>
          ) : null}
        </span>
        <Num tone={closed ? "muted" : undefined} title={closed ? "Market closed: last close" : undefined}>
          {data ? fmtPrice(data.markPrice) : isPending ? <Skeleton className="w-12" /> : closed ? close.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : NONE}
        </Num>
        <Num tone="muted" className="text-xs" title="Funding rate">
          {data?.funding.currentFundingRateBps ? fmtBps(data.funding.currentFundingRateBps) : `${config?.maxLeverage ?? ""}${config ? "x max" : ""}`}
        </Num>
        {closed && close.changeBps !== null ? <Num tone={toneOf(close.changeBps)} className="text-xs">{fmtChange(close.changeBps)}</Num> : <Change stats={stats} className="text-xs" />}
      </button>
    </li>
  );
}

/// Chooses the market to show: `?market=` when it names a listed one (links from the Markets page),
/// else the first the registry lists. It renders nothing, and sits in its own Suspense boundary
/// because reading the URL suspends; keeping that out of the list means the list hydrates together
/// with the rest of the page instead of after the market query has already answered.
export function MarketFromUrl() {
  const { data: markets } = usePerpMarkets();
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const requested = useSearchParams().get("market")?.toUpperCase();
  const picking = useRef(false);
  // The URL is applied once per value. The URL keeps `?market=` after the user picks another market
  // in the list, so applying it on every `symbol` change would snap the terminal back to it.
  const applied = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!markets?.length) return;
    const symbols = markets.map((market) => symbolOf(market.marketId));
    if (requested && symbols.includes(requested)) {
      if (applied.current !== requested) {
        applied.current = requested;
        if (symbol !== requested) setSymbol(requested);
      }
    } else if (!symbol && !picking.current) {
      // The first market that has a price right now: at the weekend the equities are closed and answer
      // `MarketSessionClosed`, so the terminal would open on a market with no price. Falls back to the first listed.
      picking.current = true;
      void firstPriced(symbols).then(setSymbol);
    }
  }, [markets, symbol, requested, setSymbol]);

  return null;
}

/// The group filter. A native `<select>` opens the browser's own list, which ignores the theme, so this
/// is a menu in the NetworkMenu style: raised fill, hairline border, accent tint on hover and selection.
function GroupMenu({ tabs, value, onChange }: { tabs: Array<{ id: GroupTab; label: string }>; value: GroupTab; onChange: (value: GroupTab) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const current = tabs.find((tab) => tab.id === value)?.label ?? "All";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Market group: ${current}. Open the group menu.`}
        onClick={() => setOpen((state) => !state)}
        className="flex h-9 items-center gap-2 rounded-control border border-line bg-raised px-2.5 text-sm font-medium text-text transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg"
      >
        {current}
        <svg aria-hidden="true" viewBox="0 0 10 6" className={cn("h-1.5 w-2.5 fill-none stroke-current transition-transform duration-150", open && "rotate-180")} strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 max-h-[min(20rem,60vh)] w-44 overflow-y-auto rounded-panel border border-line bg-raised py-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="menuitemradio"
              aria-checked={tab.id === value}
              className={cn(menuItem, "flex min-h-11 w-full items-center justify-between px-3 text-left text-sm", tab.id === value && "bg-accent-soft font-medium")}
              onClick={() => {
                onChange(tab.id);
                close();
              }}
            >
              {tab.label}
              {tab.id === value ? <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MarketList() {
  const { data: markets, isPending, error } = usePerpMarkets();
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<GroupTab>("all");
  const list = useRef<HTMLUListElement>(null);

  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  const rows = symbols.map((symbol) => ({ symbol, group: groupForSymbol(env.chainId, symbol) }));
  const tabs = groupTabs(rows);
  const shown = inGroup(rows, group)
    .map((row) => row.symbol)
    .filter((value) => value.includes(filter.trim().toUpperCase()));

  // Up and Down walk the list without leaving the keyboard; Enter or Space then picks the market.
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <Panel title="Markets" className="h-full">
      {symbols.length >= FILTER_FROM ? (
        <div className="flex gap-2 border-b border-line p-2">
          {tabs.length > 2 ? <GroupMenu tabs={tabs} value={group} onChange={setGroup} /> : null}
          <input
            type="search"
            aria-label="Filter markets"
            placeholder="Filter markets"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-line bg-ground px-2 text-sm placeholder:text-faint hover:border-accent-line focus:border-accent-fg"
          />
        </div>
      ) : null}
      {isPending ? (
        <p className="p-3 text-muted">Loading markets…</p>
      ) : error ? (
        <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
      ) : symbols.length === 0 ? (
        <p className="p-3 text-muted">No perpetual markets are listed on the registry yet.</p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-muted">No market matches “{filter}”.</p>
      ) : (
        <ul ref={list} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((value) => (
            <MarketRow key={value} symbol={value} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
