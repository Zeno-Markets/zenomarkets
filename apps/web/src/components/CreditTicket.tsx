"use client";

import { Button, ReviewStep, Segmented, TextField } from "@zeno/ui";
import { toBaseUnits, type CreditStatus } from "@zeno/sdk";
import type { Address } from "@zeno/types";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useWalletZeno } from "@/hooks/useZeno";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmt, fmtUsd } from "@/lib/format";
import { statusSentence } from "@/lib/lending";
import { creditReview } from "@/lib/review";
import { useModeStore } from "@/stores/mode";
import { ConnectButton } from "./ConnectButton";

type Action = "supply" | "borrow";

/// The pair as the ticket needs it: the live pair once deployed, otherwise nothing.
export interface CreditTicketPair {
  pair: Address;
  collateralToken: Address;
  status: CreditStatus;
  maxLtvBps: bigint;
  liquidationLtvBps: bigint;
  liquidationBonusBps: bigint;
  supplyCap: bigint;
  borrowCap: bigint;
  totalSupplyCollateral: bigint;
  totalBorrowedDebt: bigint;
}


/// Supply or borrow, through the review step (docs/UI_CONTRACT.md Section 7.3). Guided reviews with Back
/// and Confirm; Pro collapses the same figures above a one-shot button. The review states the caps and the
/// liquidation price before the first token approval is asked for.
export function CreditTicket({
  pair,
  position,
  price,
  symbol,
  collateralDecimals,
  debtDecimals,
}: {
  pair?: CreditTicketPair;
  position?: { collateralAmount: bigint; debtAmount: bigint };
  price?: bigint;
  symbol: string;
  collateralDecimals: number;
  debtDecimals: number;
}) {
  const mode = useAccountMode();
  const { address } = useAccount();
  const wallet = useWalletZeno();
  const run = useTx();
  const guided = useModeStore((state) => state.ticket) === "guided";
  const [action, setAction] = useState<Action>("supply");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const places = action === "supply" ? collateralDecimals : debtDecimals;
  const valid = /^\d+(\.\d+)?$/.test(amount) && (amount.split(".")[1]?.length ?? 0) <= places && Number(amount) > 0;
  const base = valid ? toBaseUnits(amount, places) : 0n;

  // What the pair refuses outright, by its status, before any figure is worked out.
  const shut = pair && (pair.status === "PAUSED" || (action === "borrow" && pair.status !== "NORMAL")) ? statusSentence(pair.status) : undefined;
  const review = valid
    ? creditReview({
        action,
        amount: base,
        symbol,
        collateralAmount: position?.collateralAmount ?? 0n,
        debtAmount: position?.debtAmount ?? 0n,
        price,
        collateralDecimals,
        debtDecimals,
        maxLtvBps: pair?.maxLtvBps ?? BigInt(env.creditExample.maxLtvBps),
        liquidationLtvBps: pair?.liquidationLtvBps ?? BigInt(env.creditExample.liquidationLtvBps),
        liquidationBonusBps: pair?.liquidationBonusBps,
        supplyCap: pair?.supplyCap ?? 0n,
        totalSupplyCollateral: pair?.totalSupplyCollateral ?? 0n,
        borrowCap: pair?.borrowCap ?? 0n,
        totalBorrowedDebt: pair?.totalBorrowedDebt ?? 0n,
      })
    : undefined;

  // Why Confirm cannot sign, even with a sound review on screen.
  const unsigned = !pair ? "Lending is not live on this network yet, so there is nothing to sign." : !wallet ? "Connect a wallet first." : undefined;
  const problem = shut ?? review?.refusal;

  async function submit() {
    if (!pair || !wallet || !address || !review?.rows || shut) return;
    setBusy(true);
    let ok: boolean;
    if (action === "supply") {
      const allowance = await wallet.erc20.allowance(pair.collateralToken, address, pair.pair);
      if (allowance < base) {
        const approved = await run({ title: `Approve ${symbol}` }, (tx) => wallet.erc20.approve(pair.collateralToken, pair.pair, base, tx));
        if (!approved.ok) return setBusy(false);
      }
      ok = (await run({ title: "Supply", summary: `${fmt(base, collateralDecimals, 6)} ${symbol}` }, (tx) => wallet.credit.depositCollateral(pair.pair, base, tx))).ok;
    } else {
      ok = (await run({ title: "Borrow", summary: fmtUsd(base, debtDecimals, 3) }, (tx) => wallet.credit.borrow(pair.pair, base, tx))).ok;
    }
    if (ok) {
      setAmount("");
      setReviewing(false);
    }
    setBusy(false);
  }

  const label = action === "supply" ? `Supply ${symbol}` : "Borrow USDG";

  if (guided && reviewing && review?.rows && !shut) {
    return (
      <div className="border-t border-line p-4">
        <ReviewStep
          title={label}
          className="max-w-md"
          rows={review.rows}
          worstCase={review.worstCase}
          blocked={unsigned}
          busy={busy}
          confirmLabel={`Confirm: ${label}`}
          onBack={() => setReviewing(false)}
          onConfirm={submit}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line p-4">
      <Segmented<Action>
        label="Supply or borrow"
        className="max-w-xs"
        value={action}
        onChange={(next) => {
          setAction(next);
          setAmount("");
        }}
        options={[
          { value: "supply", label: "Supply" },
          { value: "borrow", label: "Borrow" },
        ]}
      />
      <TextField
        label={action === "supply" ? `Amount (${symbol})` : "Amount (USDG)"}
        className="max-w-xs"
        value={amount}
        onValueChange={setAmount}
        placeholder="100"
        invalid={amount !== "" && !valid}
      />
      {!guided && review?.rows ? <ReviewStep title="Review: every figure" className="max-w-md" rows={review.rows} worstCase={review.worstCase} /> : null}
      {problem ? <p className="max-w-prose leading-snug text-down">{problem}</p> : null}
      {guided ? (
        <Button variant="primary" className="max-w-xs" disabled={!review?.rows || Boolean(shut)} onClick={() => setReviewing(true)}>
          Review
        </Button>
      ) : mode === "disconnected" ? (
        <ConnectButton className="max-w-xs" />
      ) : (
        <>
          <Button variant="primary" className="max-w-xs" disabled={!review?.rows || Boolean(shut) || Boolean(unsigned) || busy} onClick={submit}>
            {busy ? "Sending…" : label}
          </Button>
          {unsigned ? <p className="max-w-prose text-xs leading-snug text-muted">{unsigned}</p> : null}
        </>
      )}
    </div>
  );
}
