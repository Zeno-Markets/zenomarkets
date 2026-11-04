"use client";

import { useState } from "react";
import { PnlCard, SampleBadge, Num, cn } from "@zeno/ui";
import { MONO } from "@/lib/frame";
import { Choice, Line, Note, Review, Slider, Steps, pct, signed, useGoal, usd } from "./kit";

/// Chapters 9 and 10: the leaderboard with its PNL card, and copy trading. All traders, wallets and figures
/// are invented for the illustration.

type Metric = "pnl" | "roi" | "vol";
interface Trader {
  wallet: string;
  pnl: number;
  roi: number;
  vol: number;
  simulated?: boolean;
  you?: boolean;
  card: { symbol: string; side: "long" | "short"; leverage: number; entry: number; exit: number; size: number };
}

const TRADERS: Trader[] = [
  { wallet: "0x7a3f…c91d", pnl: 12480, roi: 0.62, vol: 184000, card: { symbol: "TSLA", side: "long", leverage: 5, entry: 231.4, exit: 262.8, size: 4000 } },
  { wallet: "0x19be…02aa", pnl: 9120, roi: 1.41, vol: 61000, card: { symbol: "NVDA", side: "short", leverage: 10, entry: 138.2, exit: 129.9, size: 3000 } },
  { wallet: "0xc402…77f0", pnl: 9120, roi: 0.38, vol: 240000, card: { symbol: "BABA", side: "long", leverage: 3, entry: 81.2, exit: 88.6, size: 5000 } },
  { wallet: "0x5de1…b3c7", pnl: 4210, roi: 0.95, vol: 44000, card: { symbol: "ETH", side: "long", leverage: 4, entry: 2310, exit: 2498, size: 2000 } },
  { wallet: "0x08fa…1e44", pnl: 1830, roi: 0.21, vol: 97000, card: { symbol: "TSM", side: "short", leverage: 2, entry: 181.5, exit: 172.6, size: 2500 } },
  { wallet: "You", pnl: 640, roi: 0.33, vol: 8000, you: true, card: { symbol: "BTC", side: "long", leverage: 3, entry: 59800, exit: 61250, size: 900 } },
  { wallet: "0xe91c…5a08", pnl: -2350, roi: -0.18, vol: 120000, card: { symbol: "AAPL", side: "long", leverage: 6, entry: 233.1, exit: 224.0, size: 3000 } },
];

const METRICS: { value: Metric; label: string }[] = [
  { value: "pnl", label: "PNL" },
  { value: "roi", label: "ROI" },
  { value: "vol", label: "Volume" },
];

export function LeaderboardDemo() {
  const goal = useGoal();
  const [metric, setMetric] = useState<Metric>("pnl");
  const [hidden, setHidden] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [shared, setShared] = useState(false);

  // Ties break on volume, then on wallet, as the real board does.
  const rows = TRADERS.filter((row) => !(hidden && row.you)).sort((a, b) => b[metric] - a[metric] || b.vol - a.vol || a.wallet.localeCompare(b.wallet));
  const trader = TRADERS.find((row) => row.wallet === picked);
  const show = (row: Trader) => (metric === "pnl" ? signed(row.pnl, 0) : metric === "roi" ? pct(row.roi, 0) : usd(row.vol, 0));

  let cardPnl = 0;
  let cardRoi = 0;
  if (trader) {
    const { side, entry, exit, size, leverage } = trader.card;
    cardPnl = ((side === "long" ? 1 : -1) * size * (exit - entry)) / entry;
    cardRoi = cardPnl / (size / leverage);
  }

  return (
    <>
      <Choice label="Rank by" value={metric} onChange={(value) => { setMetric(value); if (metric !== value) goal("sort"); }} options={METRICS} />
      <ol className="divide-y divide-line overflow-hidden rounded-control border border-line bg-ground">
        {rows.map((row, i) => (
          <li key={row.wallet}>
            <button
              type="button"
              aria-pressed={row.wallet === picked}
              onClick={() => {
                setPicked(row.wallet);
                setShared(false);
                goal("card");
              }}
              className={cn("flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-150", row.wallet === picked ? "bg-accent text-accent-ink" : "hover:bg-accent-soft hover:text-accent-fg")}
            >
              <span className={cn(MONO, "w-5 shrink-0 opacity-70")}>{i + 1}</span>
              <span className={cn(MONO, "min-w-0 flex-1 truncate", row.you && "font-medium")}>{row.wallet}</span>
              {row.simulated ? <SampleBadge label="Simulated" /> : null}
              <Num tone="inherit" className={cn("shrink-0 font-medium", row.wallet !== picked && metric !== "vol" && (metric === "pnl" ? row.pnl : row.roi) < 0 && "text-down")}>{show(row)}</Num>
            </button>
          </li>
        ))}
      </ol>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => {
            setHidden(event.target.checked);
            goal("hide");
          }}
          className="size-5 accent-accent"
        />
        <span>
          Hide my wallet <span className="text-muted">(a wallet can hide itself from the board)</span>
        </span>
      </label>
      <p className="-mt-2 text-xs text-faint">Ties break on volume. Pick a trader to see a closed position as a card.</p>

      {trader ? (
        <>
          <PnlCard
            symbol={trader.card.symbol}
            side={trader.card.side}
            leverage={trader.card.leverage}
            status="closed"
            pnl={signed(cardPnl)}
            roi={pct(cardRoi, 2)}
            direction={cardPnl > 0 ? "gain" : cardPnl < 0 ? "loss" : "flat"}
            entry={usd(trader.card.entry)}
            exit={usd(trader.card.exit)}
            size={usd(trader.card.size, 0)}
            period={trader.wallet}
            sample
          />
          <button type="button" onClick={() => setShared(true)} className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
            {shared ? "Link copied" : "Share this card"}
          </button>
          {shared ? <Note tone="up">The shared link carries the same figures as the card: market, side, PNL and ROI.</Note> : null}
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- copy trading

interface Trade {
  market: string;
  side: "long" | "short";
  /// The share of the trader's own balance this trade risks.
  risk: number;
  leverage: number;
}

const FEEDS: Record<string, { label: string; trades: Trade[] }> = {
  steady: {
    label: "Steady trader",
    trades: [
      { market: "TSLA", side: "long", risk: 0.05, leverage: 2 },
      { market: "NVDA", side: "short", risk: 0.08, leverage: 3 },
      { market: "ETH", side: "long", risk: 0.06, leverage: 2 },
      { market: "BABA", side: "long", risk: 0.1, leverage: 4 },
      { market: "TSM", side: "short", risk: 0.07, leverage: 3 },
      { market: "BTC", side: "long", risk: 0.09, leverage: 2 },
    ],
  },
  bold: {
    label: "Bold trader",
    trades: [
      { market: "NVDA", side: "long", risk: 0.12, leverage: 8 },
      { market: "TSLA", side: "short", risk: 0.2, leverage: 10 },
      { market: "BABA", side: "long", risk: 0.15, leverage: 5 },
      { market: "ETH", side: "long", risk: 0.3, leverage: 6 },
      { market: "TSM", side: "short", risk: 0.1, leverage: 4 },
      { market: "BTC", side: "long", risk: 0.25, leverage: 10 },
    ],
  },
};

export function CopyDemo() {
  const goal = useGoal();
  const [who, setWho] = useState("steady");
  const [budget, setBudget] = useState(1000);
  const [perTrade, setPerTrade] = useState(15);
  const [maxLeverage, setMaxLeverage] = useState(5);
  const [cap, setCap] = useState(40);
  const [phase, setPhase] = useState<"setup" | "review" | "running" | "stopped">("setup");
  const [step, setStep] = useState(0);

  const trades = FEEDS[who]!.trades;
  const limit = (setter: (value: number) => void) => (value: number) => {
    setter(value);
    goal("limits");
  };

  // Each trade is copied in proportion to balances, or skipped whole with its reason. Nothing is copied in part.
  let used = 0;
  const decisions = trades.map((trade) => {
    const margin = trade.risk * budget;
    const reason =
      trade.leverage > maxLeverage
        ? `${trade.leverage}x is above your ${maxLeverage}x leverage limit`
        : margin > (perTrade / 100) * budget
          ? `it risks ${(trade.risk * 100).toFixed(0)}% of the balance, above your ${perTrade}% per-trade limit`
          : used + margin > (cap / 100) * budget
            ? `it would take your total margin past ${cap}% of the budget`
            : null;
    if (!reason) used += margin;
    return { trade, margin, reason };
  });
  const shown = decisions.slice(0, step);
  const inUse = shown.reduce((sum, d) => sum + (d.reason ? 0 : d.margin), 0);

  return (
    <>
      <Steps steps={["Pick", "Limits", "Review", "Copying"]} current={phase === "setup" ? 0 : phase === "review" ? 2 : 3} />

      {phase === "setup" || phase === "review" ? (
        <>
          <Choice label="Trader to copy" value={who} onChange={(value) => { setWho(value); setPhase("setup"); }} options={Object.entries(FEEDS).map(([value, item]) => ({ value, label: item.label }))} />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Slider label="Budget for the copy account" value={budget} min={200} max={2000} step={100} onChange={limit(setBudget)} display={usd(budget, 0)} />
            <Slider label="Largest single trade (share of budget)" value={perTrade} min={5} max={30} step={5} onChange={limit(setPerTrade)} display={`${perTrade}%`} />
            <Slider label="Highest leverage" value={maxLeverage} min={2} max={10} onChange={limit(setMaxLeverage)} display={`${maxLeverage}x`} />
            <Slider label="Total margin in use (share of budget)" value={cap} min={20} max={100} step={10} onChange={limit(setCap)} display={`${cap}%`} />
          </div>
          {phase === "setup" ? (
            <button type="button" onClick={() => setPhase("review")} className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
              Review
            </button>
          ) : (
            <Review title="Review before you start" onBack={() => setPhase("setup")} onConfirm={() => { setStep(0); setPhase("running"); }} confirmLabel="Start copying">
              <Line label="Copying">{FEEDS[who]!.label}</Line>
              <Line label="Moves into a separate copy account">{usd(budget, 0)}</Line>
              <Line label="Per trade, at most">{perTrade}% of budget</Line>
              <Line label="Leverage, at most">{maxLeverage}x</Line>
              <Line label="Total margin, at most">{cap}% of budget</Line>
              <Line strong label="Your main account">Never touched</Line>
            </Review>
          )}
          <p className="text-xs text-faint">Positions the trader already holds when you start are not copied. You can stop at any time.</p>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-control border border-line bg-ground p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Your main account</p>
              <p className="mt-1 font-display text-figure font-semibold">Untouched</p>
              <p className="mt-1 text-xs text-faint">ZENO cannot withdraw from it either.</p>
            </div>
            <div className="rounded-control border border-line bg-ground p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Copy account</p>
              <Num className="mt-1 block font-display text-figure font-semibold">{usd(phase === "stopped" ? 0 : budget, 0)}</Num>
              <p className="mt-1 text-xs text-muted">{phase === "stopped" ? "Closed" : `${usd(inUse, 0)} in margin · ${usd(budget - inUse, 0)} free`}</p>
            </div>
          </div>

          <ul className="flex flex-col gap-2" aria-label="Trades from the trader you copy">
            {shown.length === 0 ? <li className="text-sm text-muted">Waiting for the trader&apos;s next trade.</li> : null}
            {shown.map(({ trade, margin, reason }, i) => (
              <li key={i} className={cn("rounded-control border px-3 py-2 text-sm", reason ? "border-down-line bg-down-soft" : "border-up-line bg-up-soft")}>
                <p className="font-medium">
                  {reason ? "Skipped" : "Copied"} · {trade.market} {trade.side} {trade.leverage}x
                </p>
                <p className="text-muted">{reason ? `Skipped because ${reason}. Nothing is copied in part.` : `${usd(margin, 0)} margin: the same ${(trade.risk * 100).toFixed(0)}% of balance the trader risked.`}</p>
              </li>
            ))}
          </ul>

          {phase === "running" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={step >= trades.length}
                onClick={() => {
                  setStep(step + 1);
                  if (decisions[step]?.reason) goal("skip");
                }}
                className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
              >
                {step >= trades.length ? "No more trades" : "Trader makes a trade"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase("stopped");
                  goal("stop");
                }}
                className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg"
              >
                Stop and withdraw
              </button>
            </div>
          ) : (
            <>
              <Note tone="up">Stopped. The copy account closed and {usd(budget, 0)} went back to you. ZENO&apos;s executor could open and close trades on it, and it could never withdraw.</Note>
              <button type="button" onClick={() => { setPhase("setup"); setStep(0); }} className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
                Start again
              </button>
            </>
          )}
          {phase === "running" ? <p className="text-xs text-faint">Copies can lag the trader by minutes. Your limits are enforced by the executor, so keep the budget to what you can lose.</p> : null}
        </>
      )}
    </>
  );
}
