"use client";

import { Button, Num, Panel, SampleBadge, Segmented, Skeleton, cn, chip } from "@zeno/ui";
import type { LeaderboardEntry, LeaderboardMetric } from "@zeno/sdk";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useLeaderboard, usePortfolioSummary } from "@/hooks/queries";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useOnline } from "@/hooks/useOnline";
import { env } from "@/lib/env";
import { fmtSigned, fmtUsd, shortHash, signTone } from "@/lib/format";
import { fmtSignedBps } from "@/lib/leaderboard";
import { PanelState } from "./PanelState";

const metrics: Array<{ value: LeaderboardMetric; label: string }> = [
  { value: "pnl", label: "PNL" },
  { value: "roi", label: "ROI" },
  { value: "volume", label: "Volume" },
];

const head = "px-3 py-2 text-right text-xs font-normal text-muted";
const headLeft = "px-3 py-2 text-left text-xs font-normal text-muted";
const cell = "px-3 py-2.5 text-right tabular-nums";
const cellLeft = "px-3 py-2.5 text-left tabular-nums";

/// Profile links exist only behind the copy-trading flag, and only for a real wallet (sample traders are not addresses).
const profileHref = (wallet: string) => (env.copyTrading && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? `/traders/${wallet}` : undefined);

function Skeletons() {
  return (
    <div aria-busy="true" aria-label="Loading the leaderboard">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-t border-line px-3 py-3 first:border-t-0">
          <Skeleton className="w-6" />
          <Skeleton className="w-32" />
          <Skeleton className="ml-auto w-20" />
          <Skeleton className="hidden w-16 sm:inline-block" />
        </div>
      ))}
    </div>
  );
}

function Notice({ children, action }: { children: string; action?: React.ReactNode }) {
  return <PanelState action={action}>{children}</PanelState>;
}

function Table({ entries, decimals, metric, self }: { entries: LeaderboardEntry[]; decimals: number; metric: LeaderboardMetric; self?: string }) {
  const strong = (m: LeaderboardMetric) => (metric === m ? "font-medium text-text" : "text-muted");
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm sm:min-w-[860px]">
        <caption className="sr-only">Traders ranked by {metrics.find((m) => m.value === metric)?.label}, all time</caption>
        <thead>
          <tr>
            <th className={cn(headLeft, "w-16")}>Rank</th>
            <th className={headLeft}>Trader</th>
            <th className={head}>PNL</th>
            <th className={head}>ROI</th>
            <th className={cn(head, "max-sm:hidden")}>Volume</th>
            <th className={cn(head, "max-sm:hidden")}>Trades</th>
            <th className={cn(head, "max-sm:hidden")}>Max drawdown</th>
            <th className={cn(head, "max-sm:hidden")}>Win rate</th>
            <th className={cn(head, "max-sm:hidden")}>
              <span className="inline-flex items-center gap-2">
                Copy
                {env.copyTrading ? null : <SampleBadge label="In development" />}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const mine = entry.wallet === self;
            return (
              <tr key={entry.wallet} aria-current={mine ? "true" : undefined} className={cn("border-t border-line", mine && "bg-accent-soft")}>
                <td className={cellLeft}>{entry.rank}</td>
                <td className={cellLeft}>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {profileHref(entry.wallet) ? (
                      <Link href={profileHref(entry.wallet)!} title={entry.wallet} className="underline decoration-line underline-offset-4 hover:decoration-text">
                        {shortHash(entry.wallet)}
                      </Link>
                    ) : (
                      <span title={entry.wallet}>{shortHash(entry.wallet)}</span>
                    )}
                    {entry.sample ? <SampleBadge label="Simulated" /> : null}
                    {mine ? <span className="text-xs text-accent-fg">you</span> : null}
                  </span>
                </td>
                <td className={cn(cell, metric === "pnl" && "font-medium")}>
                  <Num tone={signTone(entry.totalPnl, decimals)}>{fmtSigned(entry.totalPnl, decimals)}</Num>
                </td>
                <td className={cn(cell, strong("roi"))}>
                  <Num tone={entry.roiBps === 0n ? "neutral" : entry.roiBps > 0n ? "up" : "down"}>{fmtSignedBps(entry.roiBps)}</Num>
                </td>
                <td className={cn(cell, strong("volume"), "max-sm:hidden")}>{fmtUsd(entry.volume, decimals, 0)}</td>
                <td className={cn(cell, "max-sm:hidden")}>{entry.tradeCount}</td>
                <td className={cn(cell, "text-muted max-sm:hidden")} title="Not recorded yet">
                  –
                </td>
                <td className={cn(cell, "max-sm:hidden")}>{entry.winRateBps === null ? "–" : `${(entry.winRateBps / 100).toFixed(0)}%`}</td>
                <td className={cn(cell, "max-sm:hidden")}>
                  {env.copyTrading && /^0x[0-9a-fA-F]{40}$/.test(entry.wallet) ? (
                    <Link href={`/traders/${entry.wallet}/copy`} aria-label={`Copy ${shortHash(entry.wallet)}`} tabIndex={-1}>
                      <Button size="sm">Copy</Button>
                    </Link>
                  ) : (
                    <Button size="sm" disabled title="Copy trading is not available yet" aria-label={`Copy ${shortHash(entry.wallet)}: not available yet`}>
                      Copy
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/// All seven states, in one place: loading (skeleton rows), empty (nobody has traded), populated, error,
/// offline, sample (every row and the panel marked), and the two that do not apply to a public page
/// (unauthorized: the board needs no wallet; paused market: it ranks traders, not markets).
export function LeaderboardView() {
  const [metric, setMetric] = useState<LeaderboardMetric>("pnl");
  const { address } = useAccount();
  const online = useOnline();
  const board = useLeaderboard(metric);

  const entries = board.data?.entries ?? [];

  const retry = (
    <Button size="sm" onClick={() => void board.refetch()}>
      Try again
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Rank by" value={metric} onChange={setMetric} options={metrics} className="w-full sm:w-72" />
        <p className="text-xs text-muted">All time{board.data?.updatedAt ? ` · updated ${new Date(board.data.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}</p>
      </div>

      <Panel className="flex-1" title={`Top traders by ${metrics.find((m) => m.value === metric)?.label}`} sample={board.data?.sample}>
        {!online && !board.data ? (
          <Notice action={retry}>You are offline, so the leaderboard cannot load. It will refresh by itself when you reconnect.</Notice>
        ) : board.isPending ? (
          <Skeletons />
        ) : board.isError ? (
          <Notice action={retry}>The leaderboard is not available right now. Nothing is wrong with your account. Try again in a moment.</Notice>
        ) : entries.length === 0 ? (
          <Notice
            action={
              <Link href="/perpetuals" className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
                Open a position
              </Link>
            }
          >
            No one is on the board yet. A trader appears after their first trade.
          </Notice>
        ) : (
          <Table entries={entries} decimals={board.data?.settlementDecimals ?? 6} metric={metric} self={address?.toLowerCase()} />
        )}
      </Panel>

      <p className="max-w-prose text-xs leading-snug text-muted">
        {"Ranked by total PNL (realised plus unrealised), ROI on capital deployed, or volume. Ties break on volume, then wallet. A wallet can hide itself from the board."}
      </p>
      <p className="max-w-prose text-xs leading-snug text-muted">
        {"Max drawdown shows “–” until the indexer records it. A minimum number of trades to be ranked is not applied yet, so one trade is enough today. "}
        {env.copyTrading
          ? "Copy mirrors a trader's new perp trades into a separate account with limits you set."
          : "Copy trading opens once leaders build a track record."}
      </p>
    </div>
  );
}
