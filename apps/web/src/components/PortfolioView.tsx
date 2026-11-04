"use client";

import { Num, Panel, Skeleton, Stat, Tabs, chip, cn } from "@zeno/ui";
import { OptionPositionStatus } from "@zeno/sdk";
import { useState } from "react";
import Link from "next/link";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useOrders, usePortfolioSummary, useSettlementDecimals } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { openOrderCount } from "@/lib/orders";
import { fmtSigned, fmtUsd, signTone } from "@/lib/format";
import { ConnectButton } from "./ConnectButton";
import { FundingTable, HistoryTable } from "./ActivityTables";
import { OptionPositionsTable } from "./OptionPositionsTable";
import { OrdersTable } from "./OrdersTable";
import { PanelState } from "./PanelState";
import { EmptyRow } from "./EmptyRow";
import { PerpPositionsTable } from "./PositionsTable";

type Tab = "all" | "options" | "perps" | "orders" | "funding" | "history";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All positions" },
  { id: "options", label: "Options" },
  { id: "perps", label: "Perpetuals" },
  { id: "orders", label: "Open orders" },
  { id: "funding", label: "Funding" },
  { id: "history", label: "History" },
];

/// An empty section says what is missing and offers the next step.
/// Percentages for the two-part bar under the portfolio value.
function lockedShare(available: bigint, locked: bigint): { available: number; locked: number } {
  const total = available + locked;
  if (total <= 0n) return { available: 0, locked: 0 };
  const lockedPercent = Number((locked * 10_000n) / total) / 100;
  return { available: 100 - lockedPercent, locked: lockedPercent };
}

/// PROJECT_BRIEF.md Section 28.
export function PortfolioView() {
  const mode = useAccountMode();
  const { data: summary, isPending, error } = usePortfolioSummary();
  const { data: decimals = 6 } = useSettlementDecimals();
  const [tab, setTab] = useState<Tab>("all");
  const { data: orders } = useOrders();
  const now = useNow();
  const waiting = orders ? openOrderCount(orders, BigInt(Math.floor(now / 1000))) : 0;
  const tabList = tabs.map((item) => (item.id === "orders" && waiting > 0 ? { ...item, label: `${item.label} (${waiting})` } : item));

  if (mode === "disconnected") {
    return (
      <Panel className="flex-1">
        <PanelState action={<ConnectButton />}>Connect a wallet to see your collateral, positions and history.</PanelState>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel className="flex-1">
        <PanelState>Could not read your portfolio from the chain. Check NEXT_PUBLIC_RPC_URL.</PanelState>
      </Panel>
    );
  }

  const perps = summary?.positions.perps.filter((position) => position.open) ?? [];
  // Closed and settled options stay listed: they are part of the record and their realized PnL.
  const options = summary?.positions.options ?? [];
  const openOptions = options.filter((position) => position.status === OptionPositionStatus.OPEN);
  const value = summary ? summary.balances.balance + summary.unrealizedPerpPnl : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-panel border border-line/70 bg-surface p-6">
        <p className="text-xs text-muted">Portfolio value</p>
        <p className="mt-1 font-display text-[2.5rem] font-semibold leading-tight tabular-nums">
          {isPending ? <Skeleton className="h-9 w-56" /> : fmtUsd(value, decimals)}
        </p>
        {summary ? (
          <div
            role="img"
            aria-label={`Available collateral ${fmtUsd(summary.balances.available, decimals)}, locked margin ${fmtUsd(summary.balances.lockedMargin, decimals)}`}
            className="mt-4 flex h-1.5 max-w-md overflow-hidden rounded-sharp bg-line"
          >
            <div className="bg-accent" style={{ width: `${lockedShare(summary.balances.available, summary.balances.lockedMargin).available}%` }} />
            <div className="bg-faint" style={{ width: `${lockedShare(summary.balances.available, summary.balances.lockedMargin).locked}%` }} />
          </div>
        ) : null}
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Available collateral">{fmtUsd(summary?.balances.available, decimals)}</Stat>
          <Stat label="Locked margin">{fmtUsd(summary?.balances.lockedMargin, decimals)}</Stat>
          <Stat label="Unrealized PnL">
            <Num tone={signTone(summary?.unrealizedPerpPnl, decimals)}>{fmtSigned(summary?.unrealizedPerpPnl, decimals)}</Num>
          </Stat>
          <Stat label="Realized PnL">
            <Num tone={signTone(summary?.realizedPnl, decimals)}>{fmtSigned(summary?.realizedPnl, decimals)}</Num>
          </Stat>
        </dl>
        <p className="mt-4 text-xs text-muted">
          Unrealized PnL covers perpetual positions. Option positions are priced from the pricing service and shown per position.
        </p>
      </div>

      <Panel
        className="flex-1"
        title={<Tabs label="Portfolio sections" tabs={tabList} value={tab} onChange={setTab} />}
      >
        <div role="tabpanel" className="flex-1 overflow-x-auto">
          {tab === "all" || tab === "perps" ? (
            <section aria-label="Perpetual positions">
              {tab === "all" ? <h3 className="px-3 pt-3 text-xs text-muted">Perpetuals</h3> : null}
              {perps.length === 0 ? <EmptyRow action={{ href: "/perpetuals", label: "Open a perpetual" }}>No open perpetual positions.</EmptyRow> : <PerpPositionsTable positions={perps} decimals={decimals} />}
            </section>
          ) : null}
          {tab === "all" || tab === "options" ? (
            <section aria-label="Option positions" className={tab === "all" ? "border-t border-line" : undefined}>
              {tab === "all" ? <h3 className="px-3 pt-3 text-xs text-muted">Options</h3> : null}
              {(tab === "all" ? openOptions : options).length === 0 ? (
                <EmptyRow action={{ href: "/options", label: "Open the option chain" }}>
                  {tab === "all" ? "No open option positions." : "No option positions yet."}
                </EmptyRow>
              ) : (
                <OptionPositionsTable positions={tab === "all" ? openOptions : options} />
              )}
            </section>
          ) : null}
          {tab === "orders" ? <OrdersTable /> : null}
          {tab === "funding" ? <FundingTable /> : null}
          {tab === "history" ? <HistoryTable /> : null}
        </div>
      </Panel>
    </div>
  );
}
