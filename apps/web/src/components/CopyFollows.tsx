"use client";

import { copyUnfollowMessage } from "@zeno/sdk";
import type { Address } from "@zeno/types";
import { Button, Skeleton } from "@zeno/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { useWalletZeno } from "@/hooks/useZeno";
import { useCopyConfig, useCopyFollows, useSettlementDecimals, type CopyExecutionRow, type CopyFollowRow } from "@/hooks/queries";
import { useTx } from "@/hooks/useTx";
import { postUnfollow } from "@/lib/copy";
import { shortHash } from "@/lib/format";
import { PanelState } from "./PanelState";

const STATUS_WORDS: Record<CopyExecutionRow["status"], string> = {
  open: "Copied, still open",
  closed: "Copied and closed",
  skipped: "Skipped",
  failed: "Not copied",
  opening: "Opening",
};

/// The follower's copy accounts: limits, what was copied and what was skipped (always with the reason), and the
/// stop button. Stopping signs once, takes effect in the API at once, and then revokes the executor on chain.
export function CopyFollows({ only }: { only?: string }) {
  const { address } = useAccount();
  const wallet = useWalletZeno();
  const run = useTx();
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const decimals = useSettlementDecimals().data ?? 6;
  const executor = useCopyConfig().data?.executor;
  const { data, isPending, error } = useCopyFollows(address);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  const usd = (base: string) => `$${Number(formatUnits(BigInt(base), decimals)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const follows = (data?.follows ?? []).filter((f) => !only || f.leader === only);

  async function stop(f: CopyFollowRow) {
    if (!wallet || !address) return;
    setBusy(true);
    setNote(undefined);
    try {
      const terms = { follower: address, leader: f.leader, issuedAt: Math.floor(Date.now() / 1000) };
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: copyUnfollowMessage(terms) });
      } catch {
        return setNote("The signature was not given, so copying has not stopped.");
      }
      const stopped = await postUnfollow({ ...terms, signature });
      if (!stopped.ok) return setNote(stopped.error);
      await queryClient.invalidateQueries({ queryKey: ["copy-follows"] });
      if (executor && (await wallet.subaccounts.isDelegate(f.subaccount, executor))) {
        await run({ title: "Remove Zeno's executor from the copy account" }, (tx) => wallet.subaccounts.setDelegate(f.subaccount, executor, false, tx));
      }
      setNote("Copying has stopped. Positions already open stay open in your copy account.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(f: CopyFollowRow) {
    if (!wallet) return;
    setBusy(true);
    try {
      const { available } = await wallet.subaccounts.balances(f.subaccount as Address);
      if (available <= 0n) return setNote("There is nothing free to withdraw. Close the open positions first.");
      await run({ title: "Withdraw from the copy account", summary: usd(available.toString()) }, (tx) => wallet.subaccounts.withdraw(f.subaccount as Address, available, { tx }));
    } finally {
      setBusy(false);
    }
  }

  if (!address) return <PanelState>Connect a wallet to see the traders you copy.</PanelState>;
  if (isPending) return <div className="flex flex-col gap-2 p-3" aria-busy="true"><Skeleton className="h-16 w-full" /></div>;
  if (error) return <PanelState>Your copy accounts could not be loaded. Try again in a moment.</PanelState>;
  if (follows.length === 0) return <PanelState>You are not copying anyone yet. Pick a trader on the leaderboard and choose Copy.</PanelState>;

  return (
    <div className="flex flex-col gap-4 p-4">
      {follows.map((f) => {
        const rows = (data?.executions ?? []).filter((x) => x.followId === f.id);
        return (
          <section key={f.id} aria-label={`Copying ${f.leader}`} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {shortHash(f.leader)} <span className="text-xs font-normal text-muted">{f.active ? "copying" : "stopped"}</span>
              </p>
              <div className="flex gap-2">
                {f.active ? <Button size="sm" disabled={busy} onClick={() => stop(f)}>Stop copying</Button> : null}
                <Button size="sm" disabled={busy} onClick={() => withdraw(f)}>Withdraw</Button>
              </div>
            </div>
            <p className="text-xs text-muted">
              Limits: {usd(f.maxTradeSize)} per trade, {usd(f.maxExposure)} total, up to {f.maxLeverage}x. Copy account {shortHash(f.subaccount)}.
            </p>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Nothing copied yet. New trades by this trader appear here.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {rows.slice(0, 8).map((x) => (
                  <li key={`${x.followId}-${x.leaderPositionId}`}>
                    <span className="font-medium">{x.market} {x.isLong ? "long" : "short"}</span>: {STATUS_WORDS[x.status]}
                    {x.followerSize ? ` (${usd(x.followerSize)})` : ""}
                    {x.reason ? <span className="text-muted"> {x.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {note ? <p className="max-w-prose leading-snug">{note}</p> : null}
    </div>
  );
}
