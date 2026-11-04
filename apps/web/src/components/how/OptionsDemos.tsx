"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Num, cn } from "@zeno/ui";
import { Choice, Line, Note, PayoffChart, Review, Slider, Steps, pct, signed, tone, useGoal, usd } from "./kit";

/// Chapters 5 and 6. The premium here is a toy curve (intrinsic value plus a bell of time value), not a
/// price: on the real chain a signed quote sets it. The payoff rules are the ones in /docs ("Options"):
/// European, cash-settled, buy-only, and your max loss is the premium plus the fee.

const SPOT = 100;
const STRIKES = [90, 95, 100, 105, 110];
const EXPIRIES = [7, 14, 30];
const FEE = 0.01;

type Kind = "call" | "put";

const premium = (kind: Kind, strike: number, days: number) => {
  const intrinsic = Math.max(kind === "call" ? SPOT - strike : strike - SPOT, 0);
  const time = 4 * Math.sqrt(days / 30) * Math.exp(-(((strike - SPOT) / 8) ** 2)) + 0.3;
  return Math.round((intrinsic + time) * 100) / 100;
};
const payoff = (kind: Kind, strike: number, settle: number) => Math.max(kind === "call" ? settle - strike : strike - settle, 0);

export function OptionsDemo() {
  const goal = useGoal();
  const [kind, setKind] = useState<Kind>("call");
  const [strike, setStrike] = useState(105);
  const [days, setDays] = useState(14);
  const [qty, setQty] = useState(2);
  const [phase, setPhase] = useState<"choose" | "review" | "bought">("choose");
  const [settle, setSettle] = useState(100);

  const each = premium(kind, strike, days);
  const cost = each * (1 + FEE);
  const total = cost * qty;
  const breakEven = kind === "call" ? strike + cost : strike - cost;
  const pnl = (price: number) => qty * (payoff(kind, strike, price) - cost);
  const paid = qty * payoff(kind, strike, settle);

  const pick = (k: Kind, s: number) => {
    setKind(k);
    setStrike(s);
    setPhase("choose");
    goal("pick");
  };

  return (
    <>
      <Choice label="Expiry" value={days} onChange={(value) => { setDays(value); setPhase("choose"); }} options={EXPIRIES.map((value) => ({ value, label: `${value} days` }))} />

      <div className="overflow-hidden rounded-control border border-line bg-ground text-sm">
        <div className="grid grid-cols-3 border-b border-line bg-raised px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">
          <span>Call</span>
          <span className="text-center">Strike</span>
          <span className="text-right">Put</span>
        </div>
        {STRIKES.map((s) => (
          <div key={s} className="grid grid-cols-3 border-b border-line last:border-b-0">
            {(["call", "put"] as const).map((k) => {
              const on = kind === k && strike === s;
              const itm = k === "call" ? s < SPOT : s > SPOT;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${k} at strike ${s}, premium ${premium(k, s, days)}`}
                  onClick={() => pick(k, s)}
                  className={cn("min-h-11 px-3 text-sm transition-colors duration-150", k === "call" ? "order-1 text-left" : "order-3 text-right", on ? "bg-accent text-accent-ink" : cn("hover:bg-accent-soft hover:text-accent-fg", itm && "bg-surface"))}
                >
                  <Num tone="inherit">{usd(premium(k, s, days))}</Num>
                </button>
              );
            })}
            <span className="order-2 flex items-center justify-center text-muted">
              <Num>{usd(s, 0)}</Num>
            </span>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-faint">The price now is {usd(SPOT, 0)}. Shaded cells are in the money. Premiums are an illustration.</p>

      <Steps steps={["Pick", "Review", "Sign"]} current={phase === "choose" ? 0 : phase === "review" ? 1 : 2} />

      <PayoffChart fn={pnl} from={70} to={130} marker={settle} />
      <Slider label="Where does the price end at expiry?" value={settle} min={70} max={130} onChange={(value) => { setSettle(value); if (phase === "bought") goal("settle"); }} display={usd(settle, 0)} />

      {phase === "choose" ? (
        <>
          <Slider label="Contracts" value={qty} min={1} max={5} onChange={setQty} />
          <dl className="divide-y divide-line rounded-control border border-line bg-ground px-3">
            <Line label="Premium you pay">{usd(total)}</Line>
            <Line label="Break-even at expiry">{usd(breakEven)}</Line>
            <Line label="Max loss">{usd(total)}</Line>
          </dl>
          <button type="button" onClick={() => { setPhase("review"); goal("review"); }} className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
            Review {qty} {kind}{qty > 1 ? "s" : ""}
          </button>
        </>
      ) : phase === "review" ? (
        <Review onBack={() => setPhase("choose")} onConfirm={() => setPhase("bought")} confirmLabel="Sign in wallet">
          <Line label="Option">{kind === "call" ? "Call" : "Put"} · strike {usd(strike, 0)} · {days} days</Line>
          <Line label="Contracts">{qty}</Line>
          <Line label="Premium">{usd(each * qty)}</Line>
          <Line label="Fee (example 1% of premium)">{usd(each * qty * FEE)}</Line>
          <Line label="Break-even at expiry">{usd(breakEven)}</Line>
          <Line strong label="Max loss">{usd(total)}</Line>
        </Review>
      ) : (
        <>
          <Note tone={pnl(settle) >= 0 ? "up" : "down"}>
            {paid > 0
              ? `In the money: the option pays ${usd(paid)} in cash from the oracle price at expiry. After the ${usd(total)} you paid, that is ${signed(pnl(settle))} (${pct(pnl(settle) / total)}).`
              : `Out of the money: it pays nothing. You lose the ${usd(total)} you paid, and no more. Nothing is delivered either way.`}
          </Note>
          <button type="button" onClick={() => setPhase("choose")} className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
            Pick another option
          </button>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- strategies

type Leg = { kind: Kind; strike: number; side: 1 | -1 };
interface Preset {
  label: string;
  summary: string;
  legs: (width: number) => Leg[];
  capped: boolean;
}

const PRESETS: Record<string, Preset> = {
  straddle: { label: "Straddle", summary: "Buy a call and a put at one strike. You profit from a big move either way.", legs: () => [{ kind: "call", strike: 100, side: 1 }, { kind: "put", strike: 100, side: 1 }], capped: false },
  strangle: { label: "Strangle", summary: "Buy a put below and a call above. Cheaper than a straddle, and it needs a bigger move.", legs: (w) => [{ kind: "put", strike: 100 - w, side: 1 }, { kind: "call", strike: 100 + w, side: 1 }], capped: false },
  bullcall: { label: "Bull call spread", summary: "Buy a call, sell a higher one. A capped bet on a rise: the sold call pays part of the cost.", legs: (w) => [{ kind: "call", strike: 100, side: 1 }, { kind: "call", strike: 100 + w, side: -1 }], capped: true },
  bearput: { label: "Bear put spread", summary: "Buy a put, sell a lower one. A capped bet on a fall.", legs: (w) => [{ kind: "put", strike: 100, side: 1 }, { kind: "put", strike: 100 - w, side: -1 }], capped: true },
};

export function StrategyDemo() {
  const goal = useGoal();
  const [key, setKey] = useState("straddle");
  const [width, setWidth] = useState(10);
  const [settle, setSettle] = useState(100);
  const [seen, setSeen] = useState<string[]>(["straddle"]);
  const preset = PRESETS[key]!;
  const legs = preset.legs(width);

  const net = legs.reduce((sum, leg) => sum + leg.side * premium(leg.kind, leg.strike, 30), 0);
  const pnl = (price: number) => legs.reduce((sum, leg) => sum + leg.side * payoff(leg.kind, leg.strike, price), 0) - net;
  const stats = useMemo(() => {
    const grid = Array.from({ length: 301 }, (_, i) => i * 0.5 + 50);
    const values = grid.map(pnl);
    const crossings = grid.filter((price, i) => i > 0 && Math.sign(values[i - 1]!) !== Math.sign(values[i]!)).map((price) => Math.round(price));
    return { maxLoss: -Math.min(...values), maxGain: Math.max(...values), crossings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width]);
  const hasShort = legs.some((leg) => leg.side === -1);

  return (
    <>
      <Choice
        label="Strategy"
        value={key}
        onChange={(value) => {
          setKey(value);
          goal("switch");
          const next = seen.includes(value) ? seen : [...seen, value];
          setSeen(next);
          if (next.length >= 3) goal("compare");
        }}
        options={Object.entries(PRESETS).map(([value, item]) => ({ value, label: item.label }))}
      />
      <p className="text-sm leading-relaxed text-muted">{preset.summary}</p>
      {key === "straddle" ? null : <Slider label="Strike gap" value={width} min={5} max={20} step={5} onChange={setWidth} display={usd(width, 0)} />}

      <ul className="divide-y divide-line rounded-control border border-line bg-ground px-3 text-sm">
        {legs.map((leg, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-2">
            <span>
              <span className={cn("mr-2 text-xs uppercase tracking-[0.1em]", leg.side === 1 ? "text-up" : "text-down")}>{leg.side === 1 ? "Buy" : "Sell"}</span>
              {leg.kind === "call" ? "Call" : "Put"} · strike {usd(leg.strike, 0)}
            </span>
            <Num>{leg.side === 1 ? "−" : "+"}{usd(premium(leg.kind, leg.strike, 30))}</Num>
          </li>
        ))}
      </ul>

      <PayoffChart fn={pnl} from={70} to={130} marker={settle} />
      <Slider label="Where does the price end at expiry?" value={settle} min={70} max={130} onChange={(value) => { setSettle(value); goal("drag"); }} display={usd(settle, 0)} />

      <dl className="grid grid-cols-2 gap-x-6 rounded-control border border-line bg-ground px-3 sm:grid-cols-4">
        <Cell label="Net cost">{usd(net)}</Cell>
        <Cell label="Max loss">{usd(stats.maxLoss)}</Cell>
        <Cell label="Most you can gain">{preset.capped ? usd(stats.maxGain) : "No cap"}</Cell>
        <Cell label="Break-even">{stats.crossings.map((value) => usd(value, 0)).join(" · ") || "None"}</Cell>
      </dl>
      <Note tone={pnl(settle) >= 0 ? "up" : "down"}>At {usd(settle, 0)} this strategy is worth {signed(pnl(settle))} after what you paid.</Note>
      <Note>
        {hasShort
          ? "This one has a sold leg. The contracts only let a user buy options, so it cannot be opened yet. The builder shows what it would do."
          : "Every leg is a bought option, so you can open it today: open each option from the Options ticket."}
      </Note>
    </>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-text">{children}</dd>
    </div>
  );
}
