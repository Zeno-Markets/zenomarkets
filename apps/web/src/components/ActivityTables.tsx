"use client";

import { Num, Skeleton, textLink } from "@zeno/ui";
import type { FundingPayment, HistoryEvent } from "@zeno/sdk";
import { EmptyRow } from "./EmptyRow";
import { PnlCardLink } from "./PnlCardLink";
import { useFunding, useHistory, useSettlementDecimals } from "@/hooks/queries";
import { env } from "@/lib/env";
import { closeLabel, FillIndex } from "@/lib/fills";
import { fmt, fmtPrice, fmtSigned, shortHash, signTone } from "@/lib/format";
import { perpLabel } from "@/lib/market";
import { fmtDateTime } from "@/lib/options";
import { zenoRead } from "@/lib/zeno";
import { NONE } from "./None";

export const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
export const cell = "px-3 py-2 text-right tabular-nums first:text-left";

function txLink(hash: string) {
  try {
    return zenoRead.explorer.txUrl(hash as `0x${string}`);
  } catch {
    return undefined; // NEXT_PUBLIC_EXPLORER_URL is not set
  }
}

export function TxCell({ hash }: { hash: string }) {
  const link = txLink(hash);
  return (
    <td className={cell}>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className={textLink}>
          {shortHash(hash)}
        </a>
      ) : (
        shortHash(hash)
      )}
    </td>
  );
}

const needsApi = (what: string) => (
  <p className="p-3 text-muted">{what} come from the indexer. Set NEXT_PUBLIC_API_URL to show them.</p>
);

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </div>
  );
}

export function FundingTable() {
  const { data, isPending, isError } = useFunding();
  const { data: decimals = 6 } = useSettlementDecimals();
  if (!env.apiUrl) return needsApi("Funding payments");
  if (isError) return <p className="p-3 text-down">The funding history is not available right now.</p>;
  if (isPending) return <RowsSkeleton />;
  if (data.length === 0) return <EmptyRow action={{ href: "/perpetuals", label: "Open a perpetual" }}>No funding payments yet. They appear once a position is open across a funding interval.</EmptyRow>;

  const total = data.reduce((sum: bigint, row: FundingPayment) => sum + row.amount, 0n);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr>
          <th className={head}>Time</th>
          <th className={head}>Market</th>
          <th className={head}>Position</th>
          <th className={head}>Received / paid</th>
          <th className={head}>Transaction</th>
        </tr>
      </thead>
      <tbody>
        {[...data].reverse().map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className={cell}>{fmtDateTime(row.createdAt)}</td>
            <td className={cell}>{perpLabel(row.marketId)}</td>
            <td className={cell}>#{row.positionId.toString()}</td>
            <td className={cell}>
              <Num tone={signTone(row.amount, decimals, 4)}>{fmtSigned(row.amount, decimals, 4)}</Num>
            </td>
            <TxCell hash={row.txHash} />
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line">
          <td className={cell} colSpan={3}>
            Net funding
          </td>
          <td className={cell}>
            <Num tone={signTone(total, decimals, 4)}>{fmtSigned(total, decimals, 4)}</Num>
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

const eventLabels: Record<string, string> = {
  CollateralDeposited: "Deposit",
  CollateralWithdrawn: "Withdrawal",
  OptionPositionOpened: "Option opened",
  OptionPositionClosed: "Option closed",
  OptionExercised: "Option paid out",
  PerpPositionOpened: "Perp opened",
  PerpPositionUpdated: "Perp changed",
  PerpPositionClosed: "Perp closed",
  PositionLiquidated: "Liquidated",
  LimitOrderPlaced: "Limit order set",
  LimitOrderCancelled: "Limit order cancelled",
  TriggerOrderPlaced: "Trigger order set",
  TriggerOrderCancelled: "Trigger order cancelled",
  TriggerOrderExecuted: "Trigger order filled",
  ProtocolFeeCollected: "Fee",
};

const TRIGGER_KINDS: Record<string, string> = { "0": "Stop loss", "1": "Take profit" };

function details(event: HistoryEvent, decimals: number): string {
  const args = event.args as Record<string, string | undefined>;
  const parts: string[] = [];
  if (args.positionId) parts.push(`Position #${args.positionId}`);
  if (args.size) parts.push(`Size $${fmt(BigInt(args.size), decimals, 2)}`);
  if (args.premium) parts.push(`Premium $${fmt(BigInt(args.premium), decimals, 2)}`);
  if (args.amount && /^-?\d+$/.test(args.amount)) parts.push(`$${fmt(BigInt(args.amount), decimals, 2)}`);
  if (args.realizedPnl) parts.push(`PnL ${fmtSigned(BigInt(args.realizedPnl), decimals)}`);
  if (args.pnl) parts.push(`PnL ${fmtSigned(BigInt(args.pnl), decimals)}`);
  if (args.triggerPrice) parts.push(`${TRIGGER_KINDS[args.kind ?? ""] ?? "Trigger"} at $${fmtPrice(BigInt(args.triggerPrice))}`);
  if (args.executionPrice) parts.push(`Filled at $${fmtPrice(BigInt(args.executionPrice))}`);
  return parts.join(", ") || "Recorded on chain";
}

export function HistoryTable() {
  const { data, isPending, isError } = useHistory();
  const { data: decimals = 6 } = useSettlementDecimals();
  if (!env.apiUrl) return needsApi("Transaction history");
  if (isError) return <p className="p-3 text-down">The transaction history is not available right now.</p>;
  if (isPending) return <RowsSkeleton />;
  if (data.length === 0) {
    return (
      <EmptyRow action={{ href: "/perpetuals", label: "Open a perpetual" }}>
        {"No activity yet for this wallet. Your trades appear here once you open a position."}
      </EmptyRow>
    );
  }

  // A close that a trigger or a liquidation caused says so, matching the alert the user saw.
  const index = new FillIndex();
  index.learn(data);
  const closedBy = new Map(index.fillsIn(data).map((fill) => [`${fill.txHash}:${fill.positionId}`, fill.kind]));
  const label = (event: HistoryEvent) => {
    const kind = event.eventName === "PerpPositionClosed" ? closedBy.get(`${event.txHash}:${String((event.args as { positionId?: unknown }).positionId)}`) : undefined;
    return kind ? closeLabel[kind] : (eventLabels[event.eventName] ?? event.eventName);
  };

  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr>
          <th className={head}>Time</th>
          <th className={head}>Event</th>
          <th className={head}>Details</th>
          <th className={head}>Block</th>
          <th className={head}>Transaction</th>
        </tr>
      </thead>
      <tbody>
        {[...data].reverse().map((event) => (
          <tr key={event.id} className="border-t border-line">
            <td className={cell}>{fmtDateTime(event.createdAt)}</td>
            <td className={cell}>{label(event)}</td>
            <td className={cell}>
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                {details(event, decimals)}
                {event.eventName === "PerpPositionClosed" && (event.args as { positionId?: unknown }).positionId !== undefined ? (
                  <PnlCardLink positionId={String((event.args as { positionId?: unknown }).positionId)} />
                ) : null}
              </span>
            </td>
            <td className={cell}>{event.blockNumber || NONE}</td>
            <TxCell hash={event.txHash} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
