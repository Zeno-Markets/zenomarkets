"use client";

import { Button, Num, Panel, Row, Skeleton, TextField, cn } from "@zeno/ui";
import { toBaseUnits } from "@zeno/sdk";
import type { Address } from "@zeno/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TestnetFaucet } from "./TestnetFaucet";
import { useCreditCollateralPrice, useCreditHistory, useCreditMarket, useCreditPosition, useSettlementDecimals, type CreditHistoryRow } from "@/hooks/queries";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useOnline } from "@/hooks/useOnline";
import { env } from "@/lib/env";
import { fmt, fmtUsd } from "@/lib/format";
import { fmtDateTime } from "@/lib/options";
import { zenoRead } from "@/lib/zeno";
import { fallToLiquidationBps, fmtHealth, HF_NO_DEBT, healthBand, healthFactorBps, healthWords, liquidationPrice, ltvBps, pct, statusSentence, type HealthBand } from "@/lib/lending";
import { cell, head, TxCell } from "./ActivityTables";
import { ConnectButton } from "./ConnectButton";
import { CreditTicket } from "./CreditTicket";
import { Term } from "./Term";
import { TicketModeToggle } from "./TicketModeToggle";
import { NONE } from "./None";

/// The band as words and a rule, never colour alone: the label says it and the bar below carries it too.
const bandTone: Record<HealthBand, "neutral" | "up" | "down" | "muted"> = { none: "muted", safe: "up", watch: "neutral", danger: "down", liquidatable: "down" };

function Notice({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-3 p-4">
      <p className="max-w-prose text-muted">{children}</p>
      {action}
    </div>
  );
}

/// What a health factor is, said to someone who has never used a lending market: the number, what it means for
/// the price of the collateral, and what happens if it falls under 1.00x.
function HealthReadout({ hf, price, liquidationBonusBps, symbol }: { hf: bigint; price?: bigint; liquidationBonusBps?: bigint; symbol: string }) {
  const band = healthBand(hf);
  const fall = fallToLiquidationBps(hf);
  const at = price === undefined ? undefined : liquidationPrice(price, hf);
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <Num tone={bandTone[band]} className="font-display text-[2.5rem] font-semibold leading-tight">
          {fmtHealth(hf)}
        </Num>
        <span className="text-sm font-medium">{healthWords[band].label}</span>
      </div>
      <p className="mt-1 max-w-prose text-sm leading-snug text-muted">{healthWords[band].meaning}</p>
      {fall !== undefined ? (
        <p className="mt-2 max-w-prose text-sm leading-snug">
          {band === "liquidatable"
            ? `The ${symbol} is already worth too little for this loan.`
            : `Room to fall: ${symbol} can drop ${pct(fall)}${at !== undefined ? `, falling from $${fmt(price!, 18, 2)} to $${fmt(at, 18, 2)},` : ""} before the loan can be liquidated.`}
        </p>
      ) : null}
      <p className="mt-2 max-w-prose text-xs leading-snug text-muted">
        A health factor of 1.00x is the line. Under it, anyone can repay part of the loan and take your collateral
        {liquidationBonusBps !== undefined ? ` plus a ${pct(liquidationBonusBps)} bonus` : " plus a bonus"}. You keep what is left. Over it, nobody can.
      </p>
    </div>
  );
}

/// The loan-to-value bar, with the borrow limit and the liquidation line marked on it, so "how close am I"
/// is a distance you can see and not only a number.
export function LtvBar({ ltv, maxLtv, liquidationLtv }: { ltv: bigint; maxLtv: bigint; liquidationLtv: bigint }) {
  const clamp = (value: bigint) => Math.min(100, Math.max(0, Number(value) / 100));
  const tone = ltv >= liquidationLtv ? "bg-down" : ltv >= maxLtv ? "bg-faint" : "bg-accent";
  return (
    <div className="mt-4">
      <div role="img" aria-label={`Loan to value ${pct(ltv)}. Borrow limit ${pct(maxLtv)}. Liquidation at ${pct(liquidationLtv)}.`} className="relative h-2 rounded-sharp bg-line">
        <div className={cn("h-full rounded-sharp transition-[width] duration-150", tone)} style={{ width: `${clamp(ltv)}%` }} />
        <span aria-hidden="true" className="absolute -top-1 h-4 w-px bg-text" style={{ left: `${clamp(maxLtv)}%` }} />
        <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-down" style={{ left: `${clamp(liquidationLtv)}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>Loan to value {pct(ltv)}</span>
        <span>Borrow limit {pct(maxLtv)} · Liquidated at {pct(liquidationLtv)}</span>
      </div>
    </div>
  );
}

/// A worked example the visitor can move. It needs no wallet and touches nothing: it is the same arithmetic as
/// the contract's `getPosition`, over a price from the terminal or the pair's own oracle.
function HealthCalculator({ maxLtv, liquidationLtv, price, priceFromPair, example, bonus, symbol }: { maxLtv: bigint; liquidationLtv: bigint; price?: bigint; priceFromPair: boolean; example: boolean; bonus?: bigint; symbol: string }) {
  const [amount, setAmount] = useState("1");
  const [share, setShare] = useState(40);
  const valid = /^\d+(\.\d{1,18})?$/.test(amount) && Number(amount) > 0;
  const collateralUsd = valid && price !== undefined ? (toBaseUnits(amount, 18) * price) / 10n ** 18n : undefined;
  const debtUsd = collateralUsd === undefined ? undefined : (collateralUsd * BigInt(share)) / 100n;
  const hf = collateralUsd === undefined || debtUsd === undefined ? undefined : healthFactorBps(collateralUsd, debtUsd, liquidationLtv);
  const shareLtv = BigInt(share) * 100n;

  return (
    <Panel className="lg:col-start-2 lg:row-span-2 lg:row-start-1" title={<Term term="healthFactor">How a health factor works</Term>}>
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-prose text-sm leading-snug text-muted">
          Lending here means you lock {symbol} as collateral and borrow USDG against it. How much you may borrow, and how close you are to losing the
          collateral, is one number: the health factor. Try it. Nothing on this card is on chain.
        </p>
        {example ? <p className="text-xs leading-snug text-muted">Example numbers: this pair is not deployed on this network yet, so the limits below are illustrative.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={`Collateral (${symbol})`} value={amount} onValueChange={setAmount} placeholder="1" invalid={amount !== "" && !valid} hint={price === undefined ? "Waiting for a price…" : `${symbol} price $${fmt(price, 18, 2)}${priceFromPair ? "" : " (terminal price)"}`} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            <span>Borrow {share}% of the collateral&apos;s value</span>
            <input type="range" min={0} max={100} step={1} value={share} onChange={(event) => setShare(Number(event.target.value))} className="h-11 w-full accent-accent" aria-valuetext={`${share} percent`} />
          </label>
        </div>
        {hf === undefined || collateralUsd === undefined || debtUsd === undefined ? (
          <p className="text-sm text-muted">{price === undefined ? <Skeleton className="w-40" /> : "Enter a collateral amount."}</p>
        ) : (
          <>
            <dl>
              <Row label="Collateral value">{fmtUsd(collateralUsd, 18, 2)}</Row>
              <Row label="You borrow">{fmtUsd(debtUsd, 18, 2)}</Row>
            </dl>
            <HealthReadout hf={hf} price={price} liquidationBonusBps={bonus} symbol={symbol} />
            <LtvBar ltv={shareLtv} maxLtv={maxLtv} liquidationLtv={liquidationLtv} />
            {shareLtv > maxLtv ? <p className="text-xs leading-snug text-muted">Above the borrow limit, the pair would refuse this loan: you cannot borrow past {pct(maxLtv)} of what you lock.</p> : null}
          </>
        )}
      </div>
    </Panel>
  );
}

const historyLabel: Record<CreditHistoryRow["kind"], string> = {
  supply: "Supplied",
  withdraw: "Withdrew",
  borrow: "Borrowed",
  repay: "Repaid",
  liquidated: "Liquidated",
};

/// What this wallet did in the pair, newest first. The same states as the page: not connected, not deployed, no
/// API, loading, error (with a retry), offline, empty and populated.
function CreditHistory({ symbol, collateralDecimals, debtDecimals }: { symbol: string; collateralDecimals: number; debtDecimals: number }) {
  const mode = useAccountMode();
  const online = useOnline();
  const history = useCreditHistory();
  const rows = history.data;

  const amountOf = (row: CreditHistoryRow) => {
    if (row.kind === "supply" || row.kind === "withdraw") return `${fmt(BigInt(row.amount), collateralDecimals, 6)} ${symbol}`;
    if (row.kind === "liquidated") return `${fmtUsd(BigInt(row.amount), debtDecimals, 3)} repaid, ${fmt(BigInt(row.collateralSeized ?? "0"), collateralDecimals, 6)} ${symbol} taken`;
    return fmtUsd(BigInt(row.amount), debtDecimals, 3);
  };

  return (
    <Panel className="lg:col-span-2" title="Your history">
      {mode === "disconnected" ? (
        <Notice action={<ConnectButton />}>Connect a wallet to see what you have supplied, borrowed and repaid.</Notice>
      ) : !env.creditPair ? (
        <Notice>There is no history until the pair is live on this network.</Notice>
      ) : !env.apiUrl ? (
        <Notice>Your history comes from the API. It is not set up on this build.</Notice>
      ) : !online && !rows ? (
        <Notice>You are offline, so your history cannot load. It will refresh by itself when you reconnect.</Notice>
      ) : history.isPending ? (
        <div aria-busy="true" aria-label="Loading your history" className="flex flex-col gap-2 p-4">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : history.isError ? (
        <Notice action={<Button size="sm" onClick={() => void history.refetch()}>Try again</Button>}>Your history could not be read right now. Your funds are not affected. Try again in a moment.</Notice>
      ) : !rows || rows.length === 0 ? (
        <Notice>Nothing yet. Each supply, borrow, repayment and withdrawal you make here is listed with its transaction.</Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr>
                <th className={head}>Time</th>
                <th className={head}>Action</th>
                <th className={head}>Amount</th>
                <th className={head}>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.txHash}-${row.kind}-${row.amount}`} className="border-t border-line">
                  <td className={cell}>{row.timestamp ? fmtDateTime(new Date(row.timestamp * 1000).toISOString()) : NONE}</td>
                  <td className={cell}>{historyLabel[row.kind]}</td>
                  <td className={cell}>
                    <Num>{amountOf(row)}</Num>
                  </td>
                  <TxCell hash={row.txHash} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/// The lending page's content. Seven states: loading (skeletons), empty (no pair deployed, or no position),
/// populated, error, offline, not-connected, and paused (the pair renders, prices, and refuses new loans with a
/// sentence).
export function LendingView() {
  const mode = useAccountMode();
  const online = useOnline();
  const market = useCreditMarket();
  const position = useCreditPosition();
  const symbol = env.creditSymbol;
  const deployed = Boolean(env.creditPair);
  const m = market.data;
  const collateralDecimals = useQuery({
    queryKey: ["credit-collateral-decimals", m?.collateralToken],
    queryFn: () => zenoRead.erc20.decimals(m!.collateralToken as Address),
    enabled: Boolean(m),
    staleTime: Infinity,
  });
  const price = useCreditCollateralPrice(m?.oracle, m?.collateralToken);
  // The loan is the settlement token (USDG, 6 decimals): read, never assumed.
  const { data: debtDecimals = 6 } = useSettlementDecimals();
  const cDecimals = collateralDecimals.data ?? 18;

  const maxLtv = m?.maxLtvBps ?? BigInt(env.creditExample.maxLtvBps);
  const liquidationLtv = m?.liquidationLtvBps ?? BigInt(env.creditExample.liquidationLtvBps);
  const status = m?.status;
  const refusal = status ? statusSentence(status) : undefined;
  const p = position.data;
  const hf = p ? p.healthFactorBps : undefined;

  return (
    <div className="grid flex-1 content-start gap-4 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
      <Panel
        title={`${symbol} / USDG pair`}
        actions={
          status ? (
            <span className="flex items-center gap-2">
              {m ? <TestnetFaucet token={m.collateralToken as Address} symbol={symbol} amount={10} decimals={cDecimals} /> : null}
              <span className={cn("rounded-sm border px-1 text-xs", status === "NORMAL" ? "border-line text-muted" : "border-down text-down")}>{status === "NORMAL" ? "Open" : status === "REDUCE_ONLY" ? "Reduce only" : "Paused"}</span>
            </span>
          ) : undefined
        }
      >
        {!online && !m ? (
          <Notice>You are offline, so the pair cannot be read. It will refresh by itself when you reconnect.</Notice>
        ) : !deployed ? (
          <Notice>Lending is not live on this network yet. The pair has not been deployed here, so there are no rates or caps to show. The calculator below uses example numbers, and shows how it will work.</Notice>
        ) : market.isPending ? (
          <div aria-busy="true" aria-label="Loading the lending pair" className="flex flex-col gap-2 p-4">
            <Skeleton className="w-56" />
            <Skeleton className="w-40" />
          </div>
        ) : market.isError || !m ? (
          <Notice action={<Button size="sm" onClick={() => void market.refetch()}>Try again</Button>}>The lending pair could not be read right now. Nothing is wrong with your funds. Try again in a moment.</Notice>
        ) : (
          <div className="p-4">
            {refusal ? <p role="status" className="mb-3 max-w-prose text-sm leading-snug">{refusal}</p> : null}
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Row label="Borrow limit">{pct(m.maxLtvBps)} of collateral value</Row>
              <Row label="Liquidated at">{pct(m.liquidationLtvBps)} of collateral value</Row>
              <Row label="Liquidator bonus">{pct(m.liquidationBonusBps)}</Row>
              <Row label="Collateral supplied">{`${fmt(m.totalSupplyCollateral, cDecimals, 4)} of ${fmt(m.supplyCap, cDecimals, 4)} ${symbol}`}</Row>
              <Row label="Borrowed">{`${fmtUsd(m.totalBorrowedDebt, debtDecimals, 3)} of ${fmtUsd(m.borrowCap, debtDecimals, 3)}`}</Row>
            </dl>
            <p className="mt-2 text-xs text-muted">The caps are small at launch on purpose.</p>
          </div>
        )}
      </Panel>

      <Panel title="Your position" actions={<TicketModeToggle />} className="flex-1">
        {mode === "disconnected" ? (
          <Notice action={<ConnectButton />}>Connect a wallet to see what you have supplied, what you owe, and how close you are to liquidation.</Notice>
        ) : !deployed ? (
          <Notice>There is nothing to show until the pair is live on this network.</Notice>
        ) : position.isPending ? (
          <div aria-busy="true" aria-label="Loading your position" className="p-4">
            <Skeleton className="h-9 w-40" />
          </div>
        ) : position.isError ? (
          <Notice action={<Button size="sm" onClick={() => void position.refetch()}>Try again</Button>}>Your lending position could not be read right now. Try again in a moment.</Notice>
        ) : !p || (p.collateralAmount === 0n && p.debtAmount === 0n) ? (
          <Notice>You have not supplied anything yet. When you supply {symbol} you can borrow USDG against it, up to {pct(maxLtv)} of what it is worth.</Notice>
        ) : (
          <div className="p-4">
            <HealthReadout hf={hf ?? HF_NO_DEBT} price={price.price} liquidationBonusBps={m?.liquidationBonusBps} symbol={symbol} />
            <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
              <Row label="Supplied">{`${fmt(p.collateralAmount, cDecimals, 6)} ${symbol}`}</Row>
              <Row label="Collateral value">{fmtUsd(p.collateralValueUsd, 18, 2)}</Row>
              <Row label="Borrowed">{fmtUsd(p.debtAmount, debtDecimals, 3)}</Row>
              <Row label="Loan to value">{pct(ltvBps(p.collateralValueUsd, (p.debtAmount * 10n ** 18n) / 10n ** BigInt(debtDecimals)))}</Row>
            </dl>
            <LtvBar ltv={ltvBps(p.collateralValueUsd, (p.debtAmount * 10n ** 18n) / 10n ** BigInt(debtDecimals))} maxLtv={maxLtv} liquidationLtv={liquidationLtv} />
          </div>
        )}
        <CreditTicket
          pair={m}
          position={p}
          price={price.price}
          symbol={symbol}
          collateralDecimals={cDecimals}
          debtDecimals={debtDecimals}
        />
      </Panel>

      <HealthCalculator
        maxLtv={maxLtv}
        liquidationLtv={liquidationLtv}
        price={price.price}
        priceFromPair={price.source === "pair"}
        example={!m}
        bonus={m?.liquidationBonusBps}
        symbol={symbol}
      />

      <CreditHistory symbol={symbol} collateralDecimals={cDecimals} debtDecimals={debtDecimals} />
    </div>
  );
}
