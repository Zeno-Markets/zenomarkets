"use client";

import { Button, Num, ReviewStep } from "@zeno/ui";
import { DEFAULT_SLIPPAGE_BPS, margin } from "@zeno/sdk";
import { useQuery } from "@tanstack/react-query";
import type { PerpPosition } from "@zeno/types";
import { useState } from "react";
import { useCrossPositions, usePerpMarket, usePerpMarketConfig, useTriggerSupport } from "@/hooks/queries";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useWalletZeno } from "@/hooks/useZeno";
import { useTx } from "@/hooks/useTx";
import { fmt, fmtBps, fmtPrice, fmtSigned, fmtUsd, signTone } from "@/lib/format";
import { zenoRead } from "@/lib/zeno";
import { perpLabel, symbolOf, tradeBlocker } from "@/lib/market";
import { perpCloseReview } from "@/lib/review";
import { useFillStore } from "@/stores/fills";
import { AdjustPosition } from "./AdjustPosition";
import { PnlCardLink } from "./PnlCardLink";
import { PositionTriggers } from "./TriggerOrders";
import { Term } from "./Term";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

function PositionRow({ position, decimals }: { position: PerpPosition; decimals: number }) {
  const symbol = symbolOf(position.marketId);
  const { data: market } = usePerpMarket(symbol);
  const wallet = useWalletZeno();
  const run = useTx();

  const mark = market?.markPrice;
  const pnl = mark === undefined ? undefined : margin.unrealizedPnl(position.isLong, position.entryPrice, mark, position.size);
  const liquidation = market
    ? margin.liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, market.risk.maintenanceMarginRateBps)
    : undefined;
  const ratio = pnl === undefined ? undefined : margin.marginRatioBps(position.collateral, pnl, position.size);
  const leverage = position.collateral === 0n ? 0n : position.size / position.collateral;
  const { data: triggersSupported } = useTriggerSupport();
  const { data: crossIds } = useCrossPositions();
  const isCross = crossIds?.has(position.positionId.toString()) ?? false;
  const [adjusting, setAdjusting] = useState(false);
  const [triggers, setTriggers] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const paused = tradeBlocker(usePerpMarketConfig(symbol)?.active);
  // The close fee is the market's taker fee, read from ZenoFeeManager.
  const { data: fees } = useQuery({ queryKey: ["fees", symbol], queryFn: () => zenoRead.fees.get(symbol), enabled: closing, staleTime: 60_000 });
  const review =
    closing && mark !== undefined && fees
      ? perpCloseReview(position, { symbol, decimals, mark, feeBps: fees.takerFee, slippageBps: BigInt(DEFAULT_SLIPPAGE_BPS) })
      : undefined;

  async function close() {
    if (!wallet) return;
    setBusy(true);
    const result = await run({ title: "Close position", summary: `${perpLabel(position.marketId)} · ${fmtUsd(position.size, decimals, 0)}` }, (tx) =>
      wallet.perps.closePosition(position.positionId, { tx }),
    );
    if (result.ok) setClosing(false);
    setBusy(false);
  }

  return (
    <>
      <tr className="border-t border-line">
        <td className={cell}>
          <span className="font-medium">{perpLabel(position.marketId)}</span>
          <span className={position.isLong ? "ml-2 text-up" : "ml-2 text-down"}>{position.isLong ? "Long" : "Short"}</span>
          {isCross ? <span className="ml-2 text-xs text-muted">Cross</span> : null}
          {paused ? <p className="mt-0.5 max-w-64 whitespace-normal text-xs leading-snug text-down">{paused}</p> : null}
        </td>
        <td className={cell}>{fmtUsd(position.size, decimals)}</td>
        <td className={cell}>{`${leverage}x`}</td>
        <td className={cell}>{fmtUsd(position.collateral, decimals)}</td>
        <td className={cell}>{fmtPrice(position.entryPrice)}</td>
        <td className={cell}>{fmtPrice(mark)}</td>
        <td className={cell}>
          {isCross ? <Term term="crossLiquidation">Account</Term> : fmtPrice(liquidation)}
        </td>
        <td className={cell}>{fmtBps(ratio)}</td>
        <td className={cell}>
          <Num tone={signTone(pnl, decimals)}>{fmtSigned(pnl, decimals)}</Num>
        </td>
        <td className={cell}>{fmtSigned(position.fundingAccrued, decimals)}</td>
        <td className={cell}>
          <div className="flex justify-end gap-1.5">
            <PnlCardLink positionId={position.positionId} label="Card" />
            <Button size="sm" variant="secondary" aria-expanded={adjusting} onClick={() => setAdjusting((open) => !open)}>
              Adjust
            </Button>
            {triggersSupported ? (
              <>
                <Button size="sm" variant="secondary" aria-expanded={triggers} onClick={() => setTriggers((open) => !open)}>
                  TP/SL
                </Button>
              </>
            ) : null}
            <Button size="sm" disabled={!wallet} aria-expanded={closing} onClick={() => setClosing((open) => !open)}>
              Close
            </Button>
          </div>
        </td>
      </tr>
      {closing ? (
        <tr className="border-t border-line bg-raised/40">
          <td colSpan={11} className="p-3 text-left">
            {review?.rows ? (
              <ReviewStep
                title={`Close ${perpLabel(position.marketId)}`}
                className="max-w-md"
                rows={review.rows}
                worstCase={review.worstCase}
                busy={busy}
                confirmLabel="Confirm close"
                onBack={() => setClosing(false)}
                onConfirm={close}
              />
            ) : (
              <p className="text-muted">Pricing the close…</p>
            )}
          </td>
        </tr>
      ) : null}
      {adjusting ? (
        <tr className="border-t border-line bg-raised/40">
          <td colSpan={11} className="p-0 text-left">
            <AdjustPosition position={position} decimals={decimals} />
          </td>
        </tr>
      ) : null}
      {triggers && triggersSupported ? (
        <tr className="border-t border-line bg-raised/40">
          <td colSpan={11} className="p-0 text-left">
            <PositionTriggers position={position} mark={mark} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/// The table alone, so the terminal (in a fixed-height panel) and the portfolio page can share it.
export function PerpPositionsTable({ positions, decimals }: { positions: PerpPosition[]; decimals: number }) {
  return (
    <table className="w-full min-w-[900px] text-sm">
      <thead>
        <tr>
          <th className={head}>Market</th>
          <th className={head}>Size</th>
          <th className={head}>Leverage</th>
          <th className={head}>Margin</th>
          <th className={head}>Entry</th>
          <th className={head}>Mark</th>
          <th className={head}>Liquidation</th>
          <th className={head}>Margin ratio</th>
          <th className={head}>PnL</th>
          <th className={head}>Funding</th>
          <th className={head} />
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <PositionRow key={position.positionId.toString()} position={position} decimals={decimals} />
        ))}
      </tbody>
    </table>
  );
}
