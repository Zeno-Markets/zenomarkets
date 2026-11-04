"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MONO } from "@/lib/frame";
import { Num, cn } from "@zeno/ui";
import { Choice, Line, Note, PriceChart, Review, Slider, Steps, pct, scenario, signed, tone, useGoal, usd } from "./kit";

/// Chapters 3 and 4: a perpetual and its orders. The formulas are the ones in /docs ("Perpetuals",
/// "Liquidation"): size = margin x leverage, and a long is liquidated at entry x (1 - 1/leverage + maintenance
/// rate). The rates and tiers below are the example's own. A real market sets its own and the order panel
/// reads them from the chain.

const MAINTENANCE = 0.025;
const TAKER_FEE = 0.001;
const LEVERAGE = [2, 5, 10];
const PATH = scenario(
  [
    [0, 100],
    [0.2, 92],
    [0.4, 97],
    [0.7, 106],
    [1, 110],
  ],
  61,
);

type Side = "long" | "short";

export function PerpDemo() {
  const goal = useGoal();
  const [side, setSide] = useState<Side>("long");
  const [margin, setMargin] = useState(100);
  const [leverage, setLeverage] = useState(5);
  const [phase, setPhase] = useState<"choose" | "review" | "open">("choose");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [calm, setCalm] = useState(true);

  useEffect(() => setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  const dir = side === "long" ? 1 : -1;
  const entry = PATH[0]!;
  const size = margin * leverage;
  const fee = size * TAKER_FEE;
  const liq = entry * (1 - dir * (1 / leverage - MAINTENANCE));
  const liqAt = useMemo(() => {
    const hit = PATH.findIndex((p) => (side === "long" ? p <= liq : p >= liq));
    return hit < 0 ? null : hit;
  }, [side, liq]);

  const index = liqAt !== null && t >= liqAt ? liqAt : t;
  const liquidated = liqAt !== null && t >= liqAt;
  const mark = PATH[index]!;
  const pnl = (dir * size * (mark - entry)) / entry;
  const ratio = (margin + pnl) / size;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((value) => Math.min(value + 1, PATH.length - 1)), 90);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (t >= PATH.length - 1 || liquidated) setPlaying(false);
    if (t >= 30) goal("scrub");
    if (liquidated) goal("liquidated");
  }, [t, liquidated, goal]);

  const restart = () => {
    setPhase("choose");
    setT(0);
    setPlaying(false);
  };

  return (
    <>
      <Steps steps={["Choose", "Review", "Sign", "Watch it"]} current={phase === "choose" ? 0 : phase === "review" ? 1 : 3} />

      {phase !== "open" ? (
        <>
          <Choice label="Side" value={side} onChange={setSide} tone={(v) => (v === "long" ? "up" : "down")} options={[{ value: "long", label: "Long (price up)" }, { value: "short", label: "Short (price down)" }]} />
          <Slider label="Margin you put up" value={margin} min={50} max={500} step={10} onChange={setMargin} display={usd(margin, 0)} />
          <div>
            <p className="mb-1.5 text-sm text-muted">Leverage</p>
            <Choice label="Leverage" value={leverage} onChange={setLeverage} options={LEVERAGE.map((value) => ({ value, label: `${value}x` }))} />
          </div>
          <dl className="divide-y divide-line rounded-control border border-line bg-ground px-3">
            <Line label="Position size (margin × leverage)">{usd(size, 0)}</Line>
            <Line label="Liquidation price">{usd(liq)}</Line>
          </dl>
          {phase === "review" ? (
            <Review onBack={() => setPhase("choose")} onConfirm={() => { setPhase("open"); goal("open"); }}>
              <Line label="Market">TSLA-PERP (example)</Line>
              <Line label="Side">{side === "long" ? "Long" : "Short"} {leverage}x</Line>
              <Line label="Size">{usd(size, 0)}</Line>
              <Line label="Margin">{usd(margin, 0)}</Line>
              <Line label="Taker fee (example 0.10%)">{usd(fee)}</Line>
              <Line label="Liquidation price">{usd(liq)}</Line>
              <Line strong label="Max loss">{usd(margin + fee)}</Line>
            </Review>
          ) : (
            <button type="button" onClick={() => { setPhase("review"); goal("review"); }} className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
              Review order
            </button>
          )}
          <p className="text-xs text-faint">Nothing is signed before the review. The review shows the size, the fee and the worst case.</p>
        </>
      ) : (
        <>
          <PriceChart
            prices={PATH}
            upTo={index}
            min={80}
            max={115}
            lines={[
              { at: entry, label: `Entry ${usd(entry, 0)}`, tone: "muted" },
              { at: liq, label: `Liquidation ${usd(liq)}`, tone: "down" },
            ]}
          />
          <Slider label="Drag time forward and watch the price move" value={t} min={0} max={PATH.length - 1} onChange={(value) => { setPlaying(false); setT(value); }} display={`step ${t} of ${PATH.length - 1}`} />
          <div className="flex flex-wrap gap-3">
            {calm ? null : (
              <button type="button" onClick={() => { if (t >= PATH.length - 1) setT(0); setPlaying((value) => !value); }} className="h-11 flex-1 rounded-control border border-line bg-raised px-3 text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
                {playing ? "Pause" : "Play"}
              </button>
            )}
            <button type="button" onClick={restart} className="h-11 flex-1 rounded-control border border-line bg-raised px-3 text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
              New order
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 divide-line rounded-control border border-line bg-ground px-3 sm:grid-cols-4 sm:gap-x-4">
            <Stat label="Price">{usd(mark)}</Stat>
            <Stat label="PNL"><Num tone={tone(pnl)}>{signed(pnl)}</Num></Stat>
            <Stat label="ROI on margin"><Num tone={tone(pnl)}>{pct(pnl / margin)}</Num></Stat>
            <Stat label="Margin ratio"><span className={cn(ratio < MAINTENANCE * 1.6 && "text-down")}>{(ratio * 100).toFixed(1)}%</span></Stat>
          </dl>
          <div className="relative h-2.5 overflow-hidden rounded-sharp bg-raised" role="img" aria-label="Margin ratio against the maintenance rate">
            <span className={cn("absolute inset-y-0 left-0 transition-[width] duration-150", ratio < MAINTENANCE * 1.6 ? "bg-down" : "bg-up")} style={{ width: `${Math.max(0, Math.min(100, (ratio / (1 / leverage + 0.1)) * 100))}%` }} />
            <span className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `${(MAINTENANCE / (1 / leverage + 0.1)) * 100}%` }} />
          </div>
          <p className="-mt-3 text-xs text-faint">The bar is your margin ratio. The black tick is the maintenance rate ({(MAINTENANCE * 100).toFixed(1)}%). Under it, anyone can liquidate you.</p>
          {liquidated ? (
            <Note tone="down">
              Liquidated at {usd(liq)}. The position closed and you lost most of your margin. What is left pays the liquidation fee and a liquidator reward (5% of the margin). If the loss were bigger than your balance, the insurance fund would cover the gap. Try 5x to see it survive.
            </Note>
          ) : (
            <Note tone={pnl >= 0 ? "up" : undefined}>
              {t === 0 ? "The position is open. Drag the slider and watch the PNL, and how close the price comes to the red line." : `${side === "long" ? "A long gains when the price rises" : "A short gains when the price falls"}. ${Math.abs(mark - liq) < 4 ? "Close to liquidation." : ""}`}
            </Note>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={cn(MONO, "mt-0.5 text-sm text-text")}>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- orders

const ORDER_PATH = scenario(
  [
    [0, 100],
    [0.25, 94],
    [0.6, 108],
    [1, 103],
  ],
  61,
);
const NOTIONAL = 500;

export function OrdersDemo() {
  const goal = useGoal();
  const [limit, setLimit] = useState(97);
  const [stop, setStop] = useState(92);
  const [take, setTake] = useState(106);
  const [t, setT] = useState(0);

  // A trigger on the wrong side of the entry is rejected, so the sliders cannot cross it.
  const sl = Math.min(stop, limit - 1);
  const tp = Math.max(take, limit + 1);

  const fillAt = ORDER_PATH.findIndex((p) => p <= limit);
  const exit = useMemo(() => {
    if (fillAt < 0) return null;
    for (let i = fillAt + 1; i < ORDER_PATH.length; i++) {
      if (ORDER_PATH[i]! <= sl) return { i, kind: "stop" as const, price: sl };
      if (ORDER_PATH[i]! >= tp) return { i, kind: "take" as const, price: tp };
    }
    return null;
  }, [fillAt, sl, tp]);

  const filled = fillAt >= 0 && t >= fillAt;
  const exited = exit !== null && t >= exit.i;
  const result = exited ? (NOTIONAL * (exit.price - limit)) / limit : null;

  useEffect(() => {
    if (exited) goal("exit");
  }, [exited, goal]);

  return (
    <>
      <PriceChart
        prices={ORDER_PATH}
        upTo={t}
        min={86}
        max={114}
        lines={[
          { at: limit, label: `Limit buy ${usd(limit, 0)}`, tone: "accent" },
          { at: sl, label: `Stop-loss ${usd(sl, 0)}`, tone: "down" },
          { at: tp, label: `Take-profit ${usd(tp, 0)}`, tone: "up" },
        ]}
        marks={[
          ...(fillAt >= 0 ? [{ index: fillAt, price: limit, tone: "accent" as const, label: "Limit order filled" }] : []),
          ...(exit ? [{ index: exit.i, price: exit.price, tone: exit.kind === "take" ? ("up" as const) : ("down" as const), label: exit.kind === "take" ? "Take-profit fired" : "Stop-loss fired" }] : []),
        ]}
      />
      <div className="grid gap-x-6 sm:grid-cols-3">
        <Slider label="Limit buy at" value={limit} min={90} max={99} onChange={(value) => { setLimit(value); goal("limit"); }} display={usd(limit, 0)} />
        <Slider label="Stop-loss at" value={sl} min={84} max={limit - 1} onChange={(value) => { setStop(value); goal("trigger"); }} display={usd(sl, 0)} />
        <Slider label="Take-profit at" value={tp} min={limit + 1} max={114} onChange={(value) => { setTake(value); goal("trigger"); }} display={usd(tp, 0)} />
      </div>
      <Slider label="Move time forward" value={t} min={0} max={ORDER_PATH.length - 1} onChange={setT} display={`step ${t} of ${ORDER_PATH.length - 1}`} />
      <Note tone={result === null ? undefined : result >= 0 ? "up" : "down"}>
        {fillAt < 0
          ? "The price never reaches your limit, so the order never fills and nothing is charged."
          : !filled
            ? `Waiting. A limit buy fills when the price falls to ${usd(limit, 0)}. Margin and fee leave your balance at the fill, not when you place the order.`
            : !exited
              ? `Filled at ${usd(limit, 0)}. The stop-loss and take-profit now watch the price. Keep moving time.`
              : exit.kind === "take"
                ? `Take-profit fired at ${usd(tp, 0)}: ${signed(result!)} on a ${usd(NOTIONAL, 0)} position.`
                : `Stop-loss fired at ${usd(sl, 0)}: ${signed(result!)}. A stop gets you out with no slippage limit, because a stop has to exit.`}
      </Note>
      <p className="text-xs text-faint">A keeper fills orders once the price is reached, so a real fill can lag the price a little. Cancel an open order any time before it fills.</p>
    </>
  );
}
