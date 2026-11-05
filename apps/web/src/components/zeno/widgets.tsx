"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { fmtUsd } from "./HeroCarousel";

/// Three hands-on calculators for the landing page, one per product, each priced from a live market. They compute
/// on the page; nothing is signed. The chart under each one is the outcome across prices, with a crosshair.

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-full border border-line bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.12em] transition-all duration-200 ${value === option.id ? "bg-ink text-paper" : "text-muted hover:text-text"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Range({ label, value, min, max, step, onChange, display }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string }) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          {label}
        </label>
        <span className="font-mono text-sm font-medium tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="zeno-range mt-2 w-full"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
    </div>
  );
}

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className={`mt-1 font-mono text-[15px] font-medium tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>{children}</p>
    </div>
  );
}

/// An outcome curve over a price range with a crosshair that follows the pointer.
function OutcomeChart({ from, to, fn, marks, spot, format }: { from: number; to: number; fn: (price: number) => number; marks: { at: number; label: string }[]; spot: number; format: (v: number) => string }) {
  const W = 560;
  const H = 190;
  const N = 90;
  const points = useMemo(() => Array.from({ length: N + 1 }, (_, i) => from + ((to - from) * i) / N).map((p) => [p, fn(p)] as const), [from, to, fn]);
  const ys = points.map(([, y]) => y);
  const lo = Math.min(...ys, 0);
  const hi = Math.max(...ys, 0);
  const pad = (hi - lo) * 0.12 || 1;
  const x = (p: number) => ((p - from) / (to - from)) * W;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * H;
  const path = points.map(([p, v], i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [hover, setHover] = useState<number | null>(null);
  const at = hover ?? spot;
  const value = fn(at);
  const clipUp = useId();
  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-48 w-full touch-none overflow-visible"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(from + ((event.clientX - rect.left) / rect.width) * (to - from));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Outcome across prices"
      >
        <defs>
          <clipPath id={`${clipUp}-up`}>
            <rect x="0" y="0" width={W} height={y(0)} />
          </clipPath>
          <clipPath id={`${clipUp}-down`}>
            <rect x="0" y={y(0)} width={W} height={H - y(0)} />
          </clipPath>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={W * f} x2={W * f} y1="0" y2={H} className="stroke-line" strokeDasharray="2 4" />
        ))}
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="stroke-faint" strokeWidth="1" />
        <path d={`${path}L${W},${y(0)}L0,${y(0)}Z`} clipPath={`url(#${clipUp}-up)`} className="fill-accent/25" />
        <path d={`${path}L${W},${y(0)}L0,${y(0)}Z`} clipPath={`url(#${clipUp}-down)`} className="fill-down/15" />
        <path d={path} fill="none" className="stroke-text" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {marks.map((mark) => (
          <g key={mark.label}>
            <line x1={x(mark.at)} x2={x(mark.at)} y1="0" y2={H} className="stroke-accent-fg" strokeDasharray="4 3" />
            <text x={x(mark.at) + 4} y="12" className="fill-accent-fg font-mono text-[10px] uppercase">
              {mark.label}
            </text>
          </g>
        ))}
        <line x1={x(at)} x2={x(at)} y1="0" y2={H} className="stroke-text/40" />
        <circle cx={x(at)} cy={y(value)} r="5" className="fill-accent stroke-ink" strokeWidth="2" />
      </svg>
      <div className="pointer-events-none absolute right-0 top-0 rounded-control bg-ink px-2.5 py-1.5 font-mono text-[11px] text-paper">
        at {fmtUsd(at)} · <span className={value >= 0 ? "text-lime" : "text-coral"}>{format(value)}</span>
      </div>
    </div>
  );
}

const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${fmtUsd(Math.abs(v))}`;

export function PerpWidget({ symbol, price, maxLeverage }: { symbol: string; price: number; maxLeverage: number }) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState(Math.min(5, maxLeverage));
  const margin = 1000;
  const size = margin * leverage;
  const qty = size / price;
  const maintenance = leverage >= 10 ? 0.05 : 0.075;
  const liq = side === "long" ? price * (1 - 1 / leverage + maintenance) : price * (1 + 1 / leverage - maintenance);
  const pnl = (p: number) => Math.max(-margin, (side === "long" ? p - price : price - p) * qty);
  const plus5 = pnl(price * (side === "long" ? 1.05 : 0.95));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={side} onChange={setSide} options={[{ id: "long", label: "Long" }, { id: "short", label: "Short" }]} />
        <span className="font-mono text-xs text-muted">{symbol}-PERP · mark {fmtUsd(price)}</span>
      </div>
      <Range label="Leverage" value={leverage} min={1} max={maxLeverage} step={1} onChange={setLeverage} display={`${leverage}x`} />
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Position">{fmtUsd(size)}</Stat>
        <Stat label="Liquidation">{fmtUsd(liq)}</Stat>
        <Stat label="5% move" tone="up">{signedUsd(plus5)}</Stat>
      </div>
      <OutcomeChart from={price * 0.85} to={price * 1.15} fn={pnl} spot={price} marks={[{ at: liq, label: "liq" }]} format={signedUsd} />
      <p className="font-mono text-[11px] text-faint">$1,000 margin · funding and fees settle on chain</p>
    </div>
  );
}

/// Black-Scholes premium per unit, for the calculator only (the venue's own quotes come signed from its pricing service).
function premium(spot: number, strike: number, years: number, vol: number, call: boolean): number {
  const d1 = (Math.log(spot / strike) + 0.5 * vol * vol * years) / (vol * Math.sqrt(years));
  const d2 = d1 - vol * Math.sqrt(years);
  const n = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
  return call ? spot * n(d1) - strike * n(d2) : strike * n(-d2) - spot * n(-d1);
}
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function OptionsWidget({ symbol, price }: { symbol: string; price: number }) {
  const [kind, setKind] = useState<"call" | "put">("call");
  const [offset, setOffset] = useState(5);
  const [days, setDays] = useState(14);
  const strike = price * (1 + (kind === "call" ? offset : -offset) / 100);
  const units = 10;
  const cost = premium(price, strike, days / 365, 0.45, kind === "call") * units;
  const payoff = (p: number) => (kind === "call" ? Math.max(0, p - strike) : Math.max(0, strike - p)) * units - cost;
  const breakeven = kind === "call" ? strike + cost / units : strike - cost / units;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={kind} onChange={setKind} options={[{ id: "call", label: "Call" }, { id: "put", label: "Put" }]} />
        <span className="font-mono text-xs text-muted">{symbol} · spot {fmtUsd(price)}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Range label="Strike" value={offset} min={1} max={20} step={1} onChange={setOffset} display={`${fmtUsd(strike)} (${kind === "call" ? "+" : "−"}${offset}%)`} />
        <Range label="Expiry" value={days} min={7} max={30} step={7} onChange={setDays} display={`${days} days`} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Premium">{fmtUsd(cost)}</Stat>
        <Stat label="Break-even">{fmtUsd(breakeven)}</Stat>
        <Stat label="Max loss">{fmtUsd(cost)}</Stat>
      </div>
      <OutcomeChart from={price * 0.75} to={price * 1.25} fn={payoff} spot={price} marks={[{ at: strike, label: "strike" }]} format={signedUsd} />
      <p className="font-mono text-[11px] text-faint">10 units · cash-settled in USDG at expiry</p>
    </div>
  );
}

export function LendingWidget({ symbol, price, maxLtv = 60, liquidationLtv = 70 }: { symbol: string; price: number; maxLtv?: number; liquidationLtv?: number }) {
  const [shares, setShares] = useState(10);
  const [ltv, setLtv] = useState(40);
  const collateral = shares * price;
  const debt = (collateral * ltv) / 100;
  const liqPrice = debt / ((shares * liquidationLtv) / 100);
  const health = liquidationLtv / ltv;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-control bg-ink px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em] text-paper">
          {symbol} → USDG
        </span>
        <span className="font-mono text-xs text-muted">oracle {fmtUsd(price)}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Range label={`Collateral (${symbol})`} value={shares} min={1} max={50} step={1} onChange={setShares} display={`${shares} · ${fmtUsd(collateral)}`} />
        <Range label="Loan to value" value={ltv} min={5} max={maxLtv} step={1} onChange={setLtv} display={`${ltv}%`} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="You borrow">{fmtUsd(debt)}</Stat>
        <Stat label="Liquidation">{fmtUsd(liqPrice)}</Stat>
        <Stat label="Room to fall" tone={health > 1.4 ? "up" : "down"}>{`${((1 - liqPrice / price) * 100).toFixed(1)}%`}</Stat>
      </div>
      <div>
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          <span>Health</span>
          <span>liquidation at {liquidationLtv}% LTV</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface ring-1 ring-line">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-down),#e8b931_45%,var(--color-accent)_80%)] transition-[width] duration-300"
            style={{ width: `${Math.min(100, (1 - ltv / liquidationLtv) * 100 + 8)}%` }}
          />
        </div>
      </div>
      <OutcomeChart
        from={price * 0.4}
        to={price * 1.2}
        // Equity is collateral minus debt until the loan crosses the liquidation LTV; past it the position is closed with a penalty.
        fn={(p) => (debt <= (shares * p * liquidationLtv) / 100 ? shares * p - debt : -debt * 0.05)}
        spot={price}
        marks={[{ at: liqPrice, label: "liq" }]}
        format={(v) => `equity ${signedUsd(v)}`}
      />
      <p className="font-mono text-[11px] text-faint">Max LTV {maxLtv}% · interest accrues per block</p>
    </div>
  );
}
