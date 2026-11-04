"use client";

import { groupForSymbol, marketsForTier, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { Num, Panel, Skeleton, Tabs, cn, chip, toneOf } from "@zeno/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MarketStats, ReferenceQuote } from "@zeno/sdk";
import { isMarketGroup, type MarketConfig, type MarketGroup } from "@zeno/types";
import { useAllMarkets, useMarketOverviews, useMarketStats, useReferenceQuotes, useSettlementDecimals } from "@/hooks/queries";
import { env } from "@/lib/env";
import { fmtBps, fmtCompactUsd, fmtPrice } from "@/lib/format";
import { useSparks } from "./zeno/data";
import type { Spark } from "@/app/api/spark/route";
import { groupTabs, inGroup, symbolOf, type GroupTab } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { useWatchlist } from "@/stores/watchlist";
import { Change, fmtChange } from "./Change";
import { MarketLogo } from "./MarketLogo";
import { PanelState } from "./PanelState";

type View = "markets" | "watchlist";

const views: Array<{ id: View; label: string }> = [
  { id: "markets", label: "Markets" },
  { id: "watchlist", label: "Watchlist" },
];

type Overview = ReturnType<typeof useMarketOverviews>[number]["data"];

type SortKey = "asset" | "index" | "change" | "trend" | "leverage" | "capacity" | "funding";

/// Columns in order. `hide` names the screen width below which a column is dropped so the table
/// fits a phone; the row still opens the market.
const columns: Array<{ key: SortKey; label: string; hide?: string }> = [
  { key: "asset", label: "Asset" },
  { key: "index", label: "Index price" },
  { key: "change", label: "24h" },
  { key: "trend", label: "5d trend", hide: "max-md:hidden" },
  { key: "leverage", label: "Max leverage", hide: "max-md:hidden" },
  { key: "capacity", label: "OI capacity", hide: "max-md:hidden" },
  { key: "funding", label: "Funding", hide: "max-sm:hidden" },
];

const cell = "px-3 py-2.5 text-right tabular-nums first:text-left max-md:px-2";
const linkClass = cn(chip, "h-8 px-2.5 text-xs font-medium");

interface Line {
  market: MarketConfig;
  symbol: string;
  group?: MarketGroup;
  stats?: MarketStats;
  overview: Overview;
  loading: boolean;
  /// The last reference close, shown while the chain has no price (an equity session that is shut).
  quote?: ReferenceQuote;
  /// Five days of the real instrument's hourly closes and its move on the day (display only).
  spark?: Spark;
}

/// A stock with no feed on this venue (most of the China group, and seven US stocks): a reference price and its change, in the same
/// columns as a market and with no trade control. The list is the same on Testnet and on Mainnet.
interface ReferenceLine {
  reference: true;
  symbol: string;
  name: string;
  group: MarketGroup;
  quote?: ReferenceQuote;
}

type Row = Line | ReferenceLine;

const isReference = (row: Row): row is ReferenceLine => "reference" in row;

/// A market you can open a position on right now. A paused market or a quote-only stock sorts below these.
const isTradable = (row: Row): boolean => !isReference(row) && row.market.active && (row.market.perpsEnabled || row.market.optionsEnabled);

const REFERENCE_LISTINGS = marketsForTier(ROBINHOOD_MAINNET_CHAIN_ID, "quoted");

/// A number to order by, or undefined when the figure is missing (those rows go last either way).
function sortValue(line: Row, key: SortKey): number | string | undefined {
  if (isReference(line)) {
    return key === "asset" ? line.symbol : key === "index" ? line.quote?.price : key === "change" ? (line.quote?.changeBps ?? undefined) : undefined;
  }
  switch (key) {
    case "asset":
      return line.symbol;
    case "index":
      return line.overview?.prices ? Number(line.overview.prices.index.price) : undefined;
    case "change":
      return line.stats?.change24hBps || (line.spark ? line.spark.changePct * 100 : undefined);
    case "trend":
      return line.spark ? line.spark.changePct : undefined;
    case "leverage":
      return Number(line.market.maxLeverage);
    case "capacity":
      return Number(line.market.openInterestCap);
    case "funding":
      return line.market.perpsEnabled && line.overview?.funding ? Number(line.overview.funding.currentFundingRateBps) : undefined;
  }
}

function sorted(lines: Row[], key: SortKey, direction: "asc" | "desc"): Row[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...lines].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sign;
  });
}

/// A figure once it has loaded, a pulse while it loads, and a dash when this market has none.
function Figure({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="w-14" /> : (children ?? "–");
}

function Trend({ closes, up }: { closes: number[]; up: boolean }) {
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min || 1;
  const d = closes.map((v, i) => `${i ? "L" : "M"}${((i / (closes.length - 1)) * 100).toFixed(1)},${(22 - ((v - min) / span) * 20).toFixed(1)}`).join("");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="ml-auto h-6 w-24" aria-hidden>
      <path d={d} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className={up ? "stroke-up" : "stroke-down"} />
    </svg>
  );
}

function MarketRow({ line, decimals }: { line: Line; decimals: number }) {
  const router = useRouter();
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { market, symbol, stats, overview, loading, quote, spark } = line;
  const liveChange = stats?.change24hBps ? undefined : spark;
  const closed = !loading && !overview?.prices && quote !== undefined;
  const perps = `/perpetuals?market=${symbol}`;

  return (
    <tr
      className={cn("border-t border-line transition-colors duration-150", market.perpsEnabled && "cursor-pointer hover:bg-accent-soft hover:shadow-[inset_3px_0_0_var(--color-accent)] active:bg-accent-soft/60")}
      onClick={market.perpsEnabled ? () => router.push(perps) : undefined}
    >
      <td className={cell}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <MarketLogo symbol={symbol} />
          {market.perpsEnabled ? (
            <Link href={perps} className="font-medium transition-colors duration-150 hover:text-accent-fg" onClick={(event) => event.stopPropagation()}>
              {symbol}
            </Link>
          ) : (
            <span className="font-medium">{symbol}</span>
          )}
          {market.active ? null : <span className="rounded-sm border border-down px-1 text-xs text-down">Paused</span>}
          {market.optionsEnabled ? (
            <Link
              href="/options"
              onClick={(event) => {
                event.stopPropagation();
                setSymbol(symbol);
              }}
              className={cn(chip, "h-7 px-2 text-xs font-medium md:hidden")}
            >
              Options
            </Link>
          ) : null}
        </div>
      </td>
      <td className={cell}>
        {closed ? (
          <span title={`Market closed. Last close from Robinhood, ${new Date(quote.asOf).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.`}>
            {quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="ml-1 text-xs text-muted">close</span>
          </span>
        ) : (
          <Figure loading={loading}>{fmtPrice(overview?.prices?.index.price)}</Figure>
        )}
      </td>
      <td className={cell}>
        {closed && quote.changeBps !== null ? (
          <Num tone={toneOf(quote.changeBps)}>{fmtChange(quote.changeBps)}</Num>
        ) : liveChange ? (
          <Num tone={toneOf(liveChange.changePct)}>{fmtChange(Math.round(liveChange.changePct * 100) || 1)}</Num>
        ) : (
          <Change stats={stats} />
        )}
      </td>
      <td className={cn(cell, "max-md:hidden")}>{spark ? <Trend closes={spark.closes} up={spark.changePct >= 0} /> : <Skeleton className="ml-auto w-24" />}</td>
      <td className={cn(cell, "max-md:hidden")}>{`${market.maxLeverage}x`}</td>
      <td className={cn(cell, "max-md:hidden")}>{fmtCompactUsd(market.openInterestCap, decimals)}</td>
      <td className={cn(cell, "max-sm:hidden")}>
        <Figure loading={loading && market.perpsEnabled}>
          {overview?.funding?.currentFundingRateBps ? fmtBps(overview.funding.currentFundingRateBps) : <span className="text-muted">Balanced</span>}
        </Figure>
      </td>
      <td className={cn(cell, "space-x-2 max-md:hidden")}>
        {market.optionsEnabled ? (
          <Link href="/options" onClick={(event) => { event.stopPropagation(); setSymbol(symbol); }} className={linkClass}>
            Trade options
          </Link>
        ) : null}
        {market.perpsEnabled ? (
          <Link href={perps} onClick={(event) => event.stopPropagation()} className={linkClass}>
            Trade perps
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

function ReferenceRow({ line }: { line: ReferenceLine }) {
  const { symbol, name, quote } = line;
  return (
    <tr className="border-t border-line">
      <td className={cell}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <MarketLogo symbol={symbol} />
          <span className="font-medium">{symbol}</span>
          <span className="text-xs font-normal text-muted max-xl:hidden">{name.replace(" • Robinhood Token", "")}</span>
        </div>
      </td>
      <td className={cell} title={quote ? `Reference price from Robinhood, updated ${new Date(quote.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : undefined}>
        {quote ? quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <Skeleton className="ml-auto w-14" />}
      </td>
      <td className={cell}>
        {quote?.changeBps === null || quote === undefined ? (
          <Num tone="muted">Today</Num>
        ) : (
          <Num tone={toneOf(quote.changeBps)}>{fmtChange(quote.changeBps)}</Num>
        )}
      </td>
      <td colSpan={4} className={cn(cell, "text-right font-mono text-xs uppercase tracking-[0.14em] text-muted max-md:hidden")}>
        Reference quote · Robinhood
      </td>
      <td className="max-md:hidden" />
    </tr>
  );
}

/// Enough markets that finding one by eye is slower than typing part of its name.
const FILTER_FROM = 6;

/// PROJECT_BRIEF.md Section 29. Every market on the registry appears, so a market added by
/// configuration shows up here with no code change. IV is left out until the pricing service has
/// a live options market to quote it from.
export function MarketsTable() {
  const { data: markets, isPending, error } = useAllMarkets();
  const { data: stats, isError: statsUnavailable } = useMarketStats();
  const { data: decimals = 6 } = useSettlementDecimals();
  // `?q=` arrives from the landing page's market search.
  const params = useSearchParams();
  const [filter, setFilter] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "asset", direction: "asc" });
  const [view, setView] = useState<View>(params.get("view") === "watchlist" ? "watchlist" : "markets");
  const { symbols: watched, ready: watchReady, load } = useWatchlist();
  useEffect(load, [load]);
  const groupParam = params.get("group") ?? "";
  const [group, setGroup] = useState<GroupTab>(isMarketGroup(groupParam) ? groupParam : "all");

  const symbols = useMemo(() => (markets ?? []).map((market) => symbolOf(market.marketId)), [markets]);
  const overviews = useMarketOverviews(symbols);
  const byId = new Map((stats ?? []).map((row) => [row.marketId, row]));

  const { data: quotes } = useReferenceQuotes();
  const { data: sparks } = useSparks();
  const lines: Line[] = (markets ?? []).map((market, index) => ({
    quote: quotes?.[symbols[index]!],
    spark: sparks?.[symbols[index]!],
    market,
    symbol: symbols[index]!,
    // The group is data in `@zeno/config`; a registry market it does not list shows under "All" only.
    group: groupForSymbol(env.chainId, symbols[index]!),
    stats: byId.get(market.marketId),
    overview: overviews[index]?.data,
    loading: overviews[index]?.isPending ?? true,
  }));
  // The listing is the same on both networks. A symbol the registry already lists is a market, not a reference row.
  const listed = new Set(symbols);
  const references: ReferenceLine[] = REFERENCE_LISTINGS.filter((listing) => !listed.has(listing.symbol)).map((listing) => ({
    reference: true,
    symbol: listing.symbol,
    name: listing.name,
    group: listing.group,
    quote: quotes?.[listing.symbol],
  }));
  const everyRow: Row[] = [...lines, ...references];
  const rows = view === "watchlist" ? everyRow.filter((row) => watched.includes(row.symbol)) : everyRow;
  const matching = sorted(
    inGroup(rows, group).filter((row) => row.symbol.includes(filter.trim().toUpperCase())),
    sort.key,
    sort.direction,
  );
  // Tradable on top, the rest below, each part in the chosen sort order.
  const tradable = matching.filter(isTradable);
  const notTradable = matching.filter((row) => !isTradable(row));
  const shown = [...tradable, ...notTradable];

  function sortBy(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : key === "asset" ? "asc" : "desc" }));
  }

  const tabs = groupTabs(rows);

  return (
    <Panel
      className="flex-1"
      title={<Tabs label="Markets sections" tabs={views} value={view} onChange={(next) => { setView(next); setGroup("all"); }} />}
      actions={
        symbols.length >= FILTER_FROM || filter ? (
          <input
            type="search"
            aria-label="Filter markets"
            placeholder="Filter markets"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="my-1 h-8 w-44 rounded-md border border-line bg-ground px-2 text-sm placeholder:text-faint hover:border-accent-line focus:border-accent-fg"
          />
        ) : null
      }
    >
      {tabs.length > 0 ? <Tabs tabs={tabs} value={group} onChange={setGroup} label="Market groups" className="border-b border-line px-2" /> : null}
      <div className="flex flex-1 flex-col overflow-x-auto">
        {isPending || (view === "watchlist" && !watchReady) ? (
          <PanelState>Loading markets…</PanelState>
        ) : error ? (
          <PanelState>Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</PanelState>
        ) : markets.length === 0 ? (
          <PanelState>No markets are listed on the registry yet.</PanelState>
        ) : view === "watchlist" && rows.length === 0 ? (
          <PanelState action={<Link href="/perpetuals" className={linkClass}>Open the terminal</Link>}>
            Your watchlist is empty. Open a market in the terminal and press Add to watchlist to pin it here.
          </PanelState>
        ) : shown.length === 0 ? (
          <PanelState>No market matches “{filter}”.</PanelState>
        ) : (
          <table className="w-full md:min-w-[900px]">
            <thead>
              <tr>
                {columns.map((column) => {
                  const active = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className={cn("px-3 py-1 text-right text-xs font-normal first:text-left max-md:px-2", column.hide)}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(column.key)}
                        className={cn("-mx-1.5 inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md px-1.5 transition-colors duration-150 hover:bg-accent-soft hover:text-accent-fg active:bg-accent active:text-accent-ink", active ? "text-accent-fg" : "text-muted")}
                      >
                        {column.label}
                        <span aria-hidden="true" className="w-2 text-[10px]">
                          {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="max-md:hidden" />
              </tr>
            </thead>
            <tbody>
              {[tradable, notTradable].map((part, index) =>
                part.length === 0 ? null : (
                  <Fragment key={index}>
                    {tradable.length > 0 && notTradable.length > 0 ? (
                      <tr className="border-t border-line bg-ground">
                        <th colSpan={columns.length + 1} scope="colgroup" className="px-3 py-2 text-left text-xs font-normal text-muted max-md:px-2">
                          {index === 0 ? `Tradable · ${part.length}` : `Reference quotes · ${part.length}`}
                        </th>
                      </tr>
                    ) : null}
                    {part.map((row) =>
                      isReference(row) ? <ReferenceRow key={row.symbol} line={row} /> : <MarketRow key={row.market.marketId} line={row} decimals={decimals} />,
                    )}
                  </Fragment>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
      {!env.apiUrl ? (
        <p className="border-t border-line p-3 text-muted">
          24h change and volumes come from the indexer. Set NEXT_PUBLIC_API_URL to show them.
        </p>
      ) : statsUnavailable ? (
        <p className="border-t border-line p-3 text-down">The statistics service is not responding, so 24h change and volumes are hidden.</p>
      ) : (
        <p className="border-t border-line p-3 text-xs text-muted">
          The 5-day trend is the real instrument, hourly. OI capacity is the open-interest cap the risk manager enforces. Reference quotes come from Robinhood.
        </p>
      )}
    </Panel>
  );
}
