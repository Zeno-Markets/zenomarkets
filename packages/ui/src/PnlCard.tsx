import type { ReactNode } from "react";
import { cn } from "./cn.js";
import { Num } from "./Num.js";
import { SampleBadge } from "./SampleBadge.js";

export interface PnlCardProps {
  symbol: string;
  side: "long" | "short";
  leverage: number;
  /// `liquidated` is rendered as itself, never as a plain loss.
  status: "open" | "closed" | "liquidated";
  /// The headline: total PNL, signed and formatted by the caller (`+$246.30`).
  pnl: string;
  /// ROI on the margin posted, signed and formatted (`+24.63%`).
  roi: string;
  direction: "gain" | "loss" | "flat";
  entry: string;
  /// Where the position closed, or the live mark while it is open. `undefined` shows a dash.
  exit?: string;
  size: string;
  /// One line of context, usually when it opened or closed.
  period?: string;
  /// The card shows simulated figures: it carries a `SAMPLE DATA` mark that cannot be removed.
  sample?: boolean;
  /// The ZENO mark, passed in because it is an image asset that belongs to the app.
  mark?: ReactNode;
  className?: string;
}

const statusLabel = { open: "Open", closed: "Closed", liquidated: "Liquidated" } as const;

/// Ivory in both themes (docs/UI_CONTRACT.md Section 4): charcoal and deep green on ivory, matching the share image, so a
/// shared card is unmistakably ZENO's in a light feed, not one more dark screenshot. Every colour on it is
/// a token. It reads like a printed statement: a double rule for a frame, one serif figure that dominates, spaced-caps
/// labels, and hairlines between the stats. Contrast, measured: charcoal on ivory 17.42:1 for the figure and the labels;
/// the deep green card accent on ivory 5.76:1. Gain and loss are told apart by the sign, the word and the triangle,
/// never by colour alone.
export function PnlCard({ symbol, side, leverage, status, pnl, roi, direction, entry, exit, size, period, sample = false, mark, className }: PnlCardProps) {
  const rule = direction === "loss" ? "bg-card-loss" : direction === "gain" ? "bg-card-accent" : "bg-charcoal/30";
  const label = "text-xs uppercase tracking-[0.16em] text-charcoal/70";
  return (
    <figure
      aria-label={`${symbol} ${side} ${status} position, ${pnl}, ${roi}`}
      className={cn("relative m-0 w-full overflow-hidden rounded-feature border border-card-accent bg-linear-to-b from-ivory to-[color-mix(in_srgb,var(--color-ivory)_95%,var(--color-charcoal))] p-6 text-charcoal sm:p-9", className)}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-1.5 rounded-panel border border-charcoal/15" />

      <div className="relative flex items-center justify-between gap-3 border-b border-charcoal/15 pb-5">
        <div className="flex items-center gap-3">
          {/* The app's mark already spells ZENO, so the plain wordmark is only the fallback. */}
          {mark ?? <span className="text-sm font-medium tracking-[0.32em]">ZENO</span>}
        </div>
        {sample ? <SampleBadge onLight /> : null}
      </div>

      <div className="relative mt-7 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-figure font-semibold">{symbol}-PERP</span>
        <span className={cn(label, "text-charcoal")}>
          {side} {leverage}x
        </span>
        <span className={cn(label, status === "liquidated" && "rounded-sharp bg-charcoal px-1.5 py-0.5 text-ivory")}>{statusLabel[status]}</span>
      </div>

      <div className="relative mt-8">
        <span aria-hidden="true" className={cn("block h-[3px] w-6", rule)} />
        <p className={cn(label, "mt-3")}>Total PNL</p>
        <Num tone="inherit" className="mt-1 block font-display text-[2.5rem] font-semibold leading-none tracking-[-0.02em] [overflow-wrap:anywhere] lining-nums sm:text-[4.25rem]">
          {pnl}
        </Num>
        <Num tone="inherit" className="mt-3 flex items-center gap-2 text-xl">
          {direction === "flat" ? null : (
            <span
              aria-hidden="true"
              className={cn("inline-block border-x-[5px] border-x-transparent", direction === "gain" ? "border-b-[9px] border-b-card-accent" : "border-t-[9px] border-t-card-loss")}
            />
          )}
          {roi}
        </Num>
      </div>

      <dl className="relative mt-8 grid grid-cols-3 divide-x divide-charcoal/15 border-t border-charcoal/15 pt-5">
        {[
          ["Entry", entry],
          [status === "open" ? "Mark" : "Exit", exit ?? "–"],
          ["Size", size],
        ].map(([term, value]) => (
          <div key={term} className="min-w-0 px-3 first:pl-0 last:pr-0 sm:px-5">
            <dt className={label}>{term}</dt>
            <dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {period || sample ? (
        <p className="relative mt-6 text-xs text-charcoal/70">
          {period}
          {sample ? `${period ? " · " : ""}Simulated. Not a real position.` : ""}
        </p>
      ) : null}
    </figure>
  );
}
