"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@zeno/ui";
import { Choice, Line, Note, Review, Slider, Steps, useGoal, usd } from "./kit";

/// Chapter 7: lending. Lending uses the formulas in /docs ("Lending"): loan to value =
/// debt / collateral value, health factor = liquidation limit / loan to value, liquidated below 1, and a
/// liquidator takes the matching collateral plus a 5% bonus. The two limits below are the example's own: a real
/// pair publishes its own and the Lending page reads them from the pair.

const BORROW_LIMIT = 0.6;
const LIQUIDATION_LIMIT = 0.75;
const REFERENCE = 250;
const BONUS = 0.05;

export function LendingDemo() {
  const goal = useGoal();
  const [units, setUnits] = useState(10);
  const [debtInput, setDebt] = useState(0);
  const [price, setPrice] = useState(REFERENCE);
  const wasRisky = useRef(false);

  const maxBorrow = units * REFERENCE * BORROW_LIMIT;
  const debt = Math.min(debtInput, maxBorrow);
  const value = units * price;
  const ltv = value > 0 ? debt / value : 0;
  const health = debt > 0 ? LIQUIDATION_LIMIT / ltv : Infinity;
  const risky = health < 1;

  useEffect(() => {
    if (debt > 0) goal("borrow");
    if (risky) {
      goal("drop");
      wasRisky.current = true;
    } else if (wasRisky.current && health >= 1.2) goal("rescue");
  }, [debt, risky, health, goal]);

  const repaid = debt / 2;
  const seized = (repaid * (1 + BONUS)) / price;
  const bar = (share: number) => `${Math.min(share, 1) * 100}%`;

  return (
    <>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Slider label="Collateral: stock tokens you lock" value={units} min={1} max={20} onChange={setUnits} display={`${units} tokens`} />
        <Slider label="Borrow (USD tokens)" value={debt} min={0} max={Math.round(maxBorrow)} step={50} onChange={setDebt} display={usd(debt, 0)} />
      </div>
      <Slider label="Stock token price (drag it down to test the loan)" value={price} min={80} max={300} step={5} onChange={setPrice} display={usd(price, 0)} />

      <div>
        <div className="relative flex h-5 overflow-hidden rounded-sharp" role="img" aria-label={`Loan to value ${(ltv * 100).toFixed(0)} percent. Borrow limit ${BORROW_LIMIT * 100} percent, liquidation limit ${LIQUIDATION_LIMIT * 100} percent.`}>
          <span className="bg-up-soft" style={{ width: bar(BORROW_LIMIT) }} />
          <span className="bg-raised" style={{ width: bar(LIQUIDATION_LIMIT - BORROW_LIMIT) }} />
          <span className="flex-1 bg-down-soft" />
          <span className={cn("absolute inset-y-0 w-1 -translate-x-1/2 bg-text transition-[left] duration-150")} style={{ left: bar(ltv) }} />
        </div>
        <p className="mt-1.5 flex justify-between text-[11px] text-muted">
          <span>0% safe</span>
          <span>{BORROW_LIMIT * 100}% borrow limit</span>
          <span>{LIQUIDATION_LIMIT * 100}% liquidation</span>
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-x-4 rounded-control border border-line bg-ground px-3">
        <Cell label="Collateral value">{usd(value, 0)}</Cell>
        <Cell label="Loan to value">{(ltv * 100).toFixed(0)}%</Cell>
        <Cell label="Health factor">
          <span className={cn("font-medium", risky ? "text-down" : health < 1.3 ? "text-text" : "text-up")}>{Number.isFinite(health) ? `${health.toFixed(2)}x` : "No loan"}</span>
        </Cell>
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={debt === 0} onClick={() => setDebt(Math.max(0, debt - Math.max(debt / 4, 50)))} className={act}>
          Repay 25%
        </button>
        <button type="button" disabled={units >= 20} onClick={() => setUnits(units + 1)} className={act}>
          Add 1 token of collateral
        </button>
      </div>

      {risky ? (
        <Note tone="down">
          Health factor under 1.00x. Anyone can now repay part of the debt and take the matching collateral plus a {BONUS * 100}% bonus. If a liquidator repays {usd(repaid, 0)}, they take {seized.toFixed(2)} tokens ({usd(seized * price, 0)}). You keep the rest, {(units - seized).toFixed(2)} tokens. Repay or add collateral to climb back above 1.00x.
        </Note>
      ) : debt === 0 ? (
        <Note>Nothing borrowed yet. Move the borrow slider: you can borrow up to {BORROW_LIMIT * 100}% of the value you locked (example limit). The pair is isolated, so this loan cannot touch your trading vault.</Note>
      ) : (
        <Note tone={health >= 1.3 ? "up" : undefined}>
          {health >= 1.3 ? "Comfortable. The price can fall a long way before this loan is in danger." : "Getting close. A small fall in the price pushes the health factor under 1.00x."} Caps are small on purpose at launch.
        </Note>
      )}
    </>
  );
}

const act =
  "h-11 rounded-control border border-line bg-raised px-3 text-sm font-medium transition-colors duration-150 enabled:hover:border-accent-fg enabled:hover:bg-accent-soft enabled:hover:text-accent-fg enabled:active:bg-accent enabled:active:text-accent-ink disabled:cursor-not-allowed disabled:text-faint";

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-text">{children}</dd>
    </div>
  );
}
