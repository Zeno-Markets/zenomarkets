"use client";

import { Button, Panel, SampleBadge, Skeleton } from "@zeno/ui";
import Link from "next/link";
import { useCopyFollowers, useLeaderboard, useSettlementDecimals } from "@/hooks/queries";
import { fmtSigned, fmtUsd } from "@/lib/format";
import { fmtSignedBps } from "@/lib/leaderboard";
import { PanelState } from "./PanelState";

/// A trader's standing on the board, how many people copy them, and the way in to copy them. Only what the
/// indexer has recorded: a trader who is not on the board has no figures here, and the page says so.
export function TraderProfile({ wallet }: { wallet: string }) {
  const board = useLeaderboard("pnl");
  const followers = useCopyFollowers(wallet);
  const decimals = useSettlementDecimals().data ?? 6;
  const entry = board.data?.entries.find((x) => x.wallet.toLowerCase() === wallet);

  return (
    <Panel
      className="flex-1"
      title="Trader profile"
      actions={
        <Link href={`/traders/${wallet}/copy`} tabIndex={-1}>
          <Button size="sm" variant="primary">Copy this trader</Button>
        </Link>
      }
    >
      {board.isPending ? (
        <div className="flex flex-col gap-2 p-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : board.error ? (
        <PanelState>The leaderboard could not be loaded, so this trader&apos;s figures are not available. You can still copy them.</PanelState>
      ) : !entry ? (
        <PanelState>This wallet is not on the leaderboard: it has no recorded trades, or it has hidden itself. You can still copy it, but there is no track record to read.</PanelState>
      ) : (
        <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Rank", `#${entry.rank}`],
            ["PNL", fmtSigned(entry.totalPnl, decimals)],
            ["ROI", fmtSignedBps(entry.roiBps)],
            ["Volume", fmtUsd(entry.volume, decimals, 0)],
            ["Trades", String(entry.tradeCount)],
            ["Win rate", entry.winRateBps === null ? "–" : `${(entry.winRateBps / 100).toFixed(0)}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="border-t border-line p-3 text-xs text-muted">
        {entry?.sample ? (
          <>
            <SampleBadge label="Simulated" className="mr-2 align-middle" />
            This wallet is a bot run by ZENO to keep the testnet active. It is not a user.{" "}
          </>
        ) : null}
        {followers.data ? `${followers.data.followers} ${followers.data.followers === 1 ? "person copies" : "people copy"} this trader. ` : ""}
        Past results do not predict future ones. Max drawdown is not recorded yet.
      </p>
    </Panel>
  );
}
