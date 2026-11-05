"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "@/lib/env";
import { SPACED_CAPS } from "@/lib/frame";
import { cn } from "@zeno/ui";
import { ArrowIcon } from "../ArrowIcon";
import { Chapter } from "./chapter";
import { totalStars, useProgress, type ChapterDef } from "./kit";
import { LendingDemo } from "./MoneyDemos";
import { OptionsDemo, StrategyDemo } from "./OptionsDemos";
import { Reward } from "./Reward";
import { CopyDemo, LeaderboardDemo } from "./SocialDemos";
import { MarketsDemo, VaultDemo } from "./StartDemos";
import { OrdersDemo, PerpDemo } from "./TradeDemos";

/// The How it works page: one chapter at a time, picked from the bar at the top. Each chapter is a short lesson:
/// a stepper, a plain-words step card, and the same demo twice, played by a cursor on the left and handed to the
/// visitor on the right. Finishing every step earns up to three stars and a reward pop-up. The demos use invented
/// figures (every panel says so) and the formulas /docs states. Nothing here reads the chain or opens a wallet.
/// A step's `acts` are what the cursor does for it; its `id` is what the demo reports when the visitor does it.

const button = (re: RegExp) => ({ click: { text: re } });

const CHAPTERS: (ChapterDef & { Demo: () => React.JSX.Element })[] = [
  {
    id: "start",
    eyebrow: "Start here",
    title: "Connect, deposit, trade, withdraw.",
    lead: "Everything on ZENO runs through one onchain vault. You put tokens in, positions lock part of them as margin, and only the free part can come out. Do the whole loop once.",
    steps: [
      { id: "connect", label: "Connect the (pretend) wallet", hint: "Press the dark Connect wallet button. On the real site this opens your own wallet. Here it is pretend, so nothing opens.", acts: [button(/^Connect wallet$/)] },
      { id: "deposit", label: "Deposit $250 into the vault", hint: "Press Deposit $250. Tokens move from your wallet into the ZENO vault, and the vault bar fills.", acts: [button(/^Deposit \$250$/)] },
      { id: "trade", label: "Open a position and watch margin lock", hint: "Press Open a position. It locks $200 of your vault as margin, and the fee is charged on top.", acts: [button(/^Open a position/)] },
      { id: "withdraw", label: "Withdraw what is free", hint: "Press Withdraw. Only the free part of the vault can leave. The locked margin stays until the position closes.", acts: [button(/^Withdraw/)] },
    ],
    href: "/portfolio",
    linkLabel: "Open your portfolio",
    Demo: VaultDemo,
  },
  {
    id: "markets",
    eyebrow: "Markets",
    title: "Pick a market, and know its status.",
    lead: "Tokenized stocks, ETFs and crypto sit in groups. Some are tradable, some only show a quote, and a paused one still renders and prices but refuses trades.",
    steps: [
      { id: "group", label: "Filter to the China group", hint: "Tap the China chip above the list. The list narrows to China-linked markets.", acts: [button(/^China$/)] },
      { id: "paused", label: "Open AAPL, a paused market, and read why", hint: "Tap All to see every market, then tap AAPL. Its card says why a paused market refuses trades.", acts: [button(/^All$/), button(/AAPL/)] },
      { id: "quote", label: "Open BIDU, a quote-only market", hint: "Tap BIDU. It has a price but no Chainlink feed yet, so its trade buttons stay off.", acts: [button(/BIDU/)] },
    ],
    href: "/markets",
    linkLabel: "Browse every market",
    Demo: MarketsDemo,
  },
  {
    id: "perpetuals",
    eyebrow: "Perpetuals",
    title: "Go long or short, and see the worst case first.",
    lead: "Choose a side, the margin and the leverage. The review shows the size, the fee and the liquidation price before your wallet is asked for anything. Then watch the price move and see what leverage does to you.",
    steps: [
      { id: "review", label: "Press Review order", hint: "Press the dark Review order button under the ticket. Nothing is signed yet: the review comes first.", acts: [button(/^Review order$/)] },
      { id: "open", label: "Sign to open the position", hint: "Read the review card: size, fee, liquidation price and your max loss. Then press Sign in wallet.", acts: [button(/^Sign in wallet$/)] },
      { id: "scrub", label: "Drag time forward and watch the PNL", hint: "Drag the slider to step 30 or further. Watch the price, the PNL and the margin ratio change.", acts: [{ slide: { range: 0 }, to: 30 }] },
      {
        id: "liquidated",
        label: "Start over with a long at 10x and get liquidated",
        hint: "Press New order, pick 10x, review and sign, then drag time to step 25. The price touches the red line and the position closes.",
        acts: [button(/^New order$/), button(/^10x$/), button(/^Review order$/), button(/^Sign in wallet$/), { slide: { range: 0 }, to: 25 }],
      },
    ],
    href: "/perpetuals",
    linkLabel: "Open the terminal",
    Demo: PerpDemo,
  },
  {
    id: "orders",
    eyebrow: "Orders",
    title: "Limit, stop-loss and take-profit.",
    lead: "A limit order waits for your price. A stop-loss and a take-profit close the position for you when the price reaches them. Set all three, then move time to see which fires first.",
    steps: [
      { id: "limit", label: "Move the limit price", hint: "Drag the Limit buy slider to a new price. The order fills when the market falls to it.", acts: [{ slide: { range: 0 }, to: 96 }] },
      { id: "trigger", label: "Move the stop-loss", hint: "Drag the Stop-loss slider. It closes the position if the price falls to that line.", acts: [{ slide: { range: 1 }, to: 90 }] },
      { id: "exit", label: "Move time until an order fires", hint: "Drag Move time forward to the right and watch for the dot where the take-profit or stop-loss fires.", acts: [{ slide: { range: 3 }, to: 60 }] },
    ],
    href: "/perpetuals",
    linkLabel: "Place an order",
    Demo: OrdersDemo,
  },
  {
    id: "options",
    eyebrow: "Options",
    title: "Buy a call or a put. Risk only the premium.",
    lead: "Pick a strike and an expiry from the chain. The payoff is drawn before you buy, and your max loss is what you pay. At expiry it settles in cash from the oracle price.",
    steps: [
      { id: "pick", label: "Pick an option from the chain", hint: "Tap any call or put in the chain. The chart below draws its payoff before you buy anything.", acts: [{ click: { css: '[aria-label^="call at strike 105"]' } }] },
      { id: "review", label: "Press Review and read it", hint: "Press the dark Review button under the chart. The review shows your break-even and your max loss.", acts: [button(/^Review \d+ calls?$/)] },
      { id: "settle", label: "Sign, then drag the expiry price", hint: "Press Sign in wallet, then drag the expiry price. In the money it pays cash. Out of the money it pays nothing.", acts: [button(/^Sign in wallet$/), { slide: { range: 0 }, to: 125 }] },
    ],
    href: "/options",
    linkLabel: "Open the option chain",
    Demo: OptionsDemo,
  },
  {
    id: "strategies",
    eyebrow: "Strategies",
    title: "Combine options and see the shape.",
    lead: "Spreads, straddles and strangles bundle several options into one payoff. Compare the shapes, the cost and the break-even before you commit to any of them.",
    steps: [
      { id: "switch", label: "Switch to Strangle", hint: "Tap Strangle. Two options at different strikes make a new payoff shape.", acts: [button(/^Strangle$/)] },
      { id: "compare", label: "Look at a third strategy", hint: "Tap Bull call spread. Compare its cost, its cap and its break-even with the others.", acts: [button(/^Bull call spread$/)] },
      { id: "drag", label: "Drag the expiry price", hint: "Drag the expiry price slider and watch the profit of the strategy move along its curve.", acts: [{ slide: { range: -1 }, to: 118 }] },
    ],
    href: env.strategies ? "/strategies" : undefined,
    linkLabel: "Open the strategy builder",
    Demo: StrategyDemo,
  },
  {
    id: "lending",
    eyebrow: "Lending",
    title: "Borrow against a stock token.",
    lead: "Lock a stock token, borrow up to a limit, and keep an eye on one number: the health factor. Under 1.00x anyone can liquidate the loan. Crash the price and see.",
    steps: [
      { id: "borrow", label: "Borrow $1,500", hint: "Drag the Borrow slider to $1,500. Loan to value and the health factor appear.", acts: [{ slide: { range: 1 }, to: 1500 }] },
      { id: "drop", label: "Drop the price until the health factor is under 1.00x", hint: "Drag the stock token price slider down below $200. The health factor falls and the bar turns red.", acts: [{ slide: { range: 2 }, to: 150 }] },
      { id: "rescue", label: "Raise the price back to get safe again", hint: "Drag the price back up to $250, or repay part of the loan, until the health factor is above 1.20x.", acts: [{ slide: { range: 2 }, to: 250 }] },
    ],
    href: env.lending ? "/lending" : undefined,
    linkLabel: "Open lending",
    Demo: LendingDemo,
  },
  {
    id: "leaderboard",
    eyebrow: "Leaderboard",
    title: "Rank traders. Share a PNL card.",
    lead: "The board ranks traders by PNL, ROI or volume. Pick a trader and a closed position becomes a card you can share. A wallet can hide itself.",
    steps: [
      { id: "sort", label: "Rank by ROI", hint: "Tap ROI. The board re-ranks by return on margin instead of dollars.", acts: [button(/^ROI$/)] },
      { id: "card", label: "Open a trader's PNL card", hint: "Tap any trader in the list. Their latest closed position becomes a card you could share.", acts: [button(/0x19be/)] },
      { id: "hide", label: "Hide your own wallet", hint: "Tick Hide my wallet below the list. Your row leaves the board.", acts: [{ click: { css: "input[type=checkbox]" } }] },
    ],
    href: "/leaderboard",
    linkLabel: "Open the leaderboard",
    Demo: LeaderboardDemo,
  },
  {
    id: "copy",
    eyebrow: "Copy trading",
    title: "Copy a trader with limits you set.",
    lead: "Follow a trader with a budget in a separate copy account. Your limits decide which trades are copied, and a trade that breaks one is skipped whole, with the reason shown. Your main account is never touched.",
    steps: [
      { id: "limits", label: "Raise the budget", hint: "Drag the Budget slider to about $1,200. Limits like this decide which trades are copied.", acts: [{ slide: { range: 0 }, to: 1200 }] },
      {
        id: "skip",
        label: "Start copying and wait for a trade to be skipped",
        hint: "Press Review, then Start copying, then press Trader makes a trade again and again until one is skipped for breaking a limit.",
        acts: [button(/^Review$/), button(/^Start copying$/), ...Array.from({ length: 6 }, () => button(/^Trader makes a trade$/))],
      },
      { id: "stop", label: "Stop and withdraw", hint: "Press Stop and withdraw. The copy account closes and the money comes back to you.", acts: [button(/^Stop and withdraw$/)] },
    ],
    href: env.copyTrading ? "/copy" : undefined,
    linkLabel: "Open copy trading",
    Demo: CopyDemo,
  },
];

/// The score at the top right of the page: stars so far, chapters finished, and a way to start over.
export function HowStats() {
  const { state, dispatch } = useProgress();
  const stars = totalStars(state.stars);
  const finished = CHAPTERS.filter((chapter) => (state.stars[chapter.id] ?? 0) > 0).length;
  return (
    <div className="flex w-full items-center justify-between gap-4 whitespace-nowrap rounded-panel border border-line bg-surface px-4 py-2.5 sm:w-auto sm:justify-start">
      <div>
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Your stars</p>
        <p className="mt-0.5 font-display text-xl font-bold leading-none tabular-nums">
          ★ {stars}
          <span className="text-sm font-normal text-faint"> / {CHAPTERS.length * 3}</span>
        </p>
      </div>
      <div className="w-28">
        <p className="text-[11px] tabular-nums text-muted">
          {finished} of {CHAPTERS.length} chapters
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={CHAPTERS.length} aria-valuenow={finished} aria-label="Chapters finished">
          <span className="block h-full bg-accent transition-[width] duration-150" style={{ width: `${(finished / CHAPTERS.length) * 100}%` }} />
        </div>
      </div>
      {stars > 0 ? (
        <button type="button" onClick={() => dispatch({ type: "reset" })} className="text-xs text-faint underline underline-offset-2 transition-colors duration-150 hover:text-text">
          Reset
        </button>
      ) : null}
    </div>
  );
}

/// The chapters as one row of text tabs on a hairline, like the app's own navigation. It scrolls sideways on a phone.
function ChapterTabs({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  const { state } = useProgress();
  const current = useRef<HTMLButtonElement>(null);

  // Keep the chosen tab in view when the row scrolls.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav aria-label="Chapters" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <ul className="flex min-w-max gap-1 lg:min-w-0 lg:justify-between">
        {CHAPTERS.map((chapter, i) => {
          const best = state.stars[chapter.id] ?? 0;
          const on = active === chapter.id;
          return (
            <li key={chapter.id}>
              <button
                ref={on ? current : undefined}
                type="button"
                onClick={() => onSelect(chapter.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-12 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors duration-150",
                  on ? "border-accent-fg font-medium text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                <span className="text-xs tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>
                {chapter.eyebrow}
                {best > 0 ? (
                  <>
                    <span aria-hidden="true" className="text-xs tracking-tighter text-up">
                      {"★".repeat(best)}
                    </span>
                    <span className="sr-only">{best} of 3 stars</span>
                  </>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Lesson() {
  const [active, setActive] = useState(CHAPTERS[0]!.id);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => {
      const id = window.location.hash.slice(1);
      if (CHAPTERS.some((chapter) => chapter.id === id)) setActive(id);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const select = useCallback((id: string) => {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    top.current?.scrollIntoView({ block: "start" });
  }, []);

  const index = CHAPTERS.findIndex((chapter) => chapter.id === active);
  const { Demo, ...def } = CHAPTERS[index]!;

  return (
    // `relative` matters: the screen-reader-only text is absolutely placed, and without a positioned parent
    // it stretches the document, so the page scrolls on past the footer.
    <div ref={top} className="relative flex flex-col gap-8 lg:gap-10">
      <ChapterTabs active={active} onSelect={select} />
      <Chapter key={def.id} def={def} index={index} total={CHAPTERS.length} Demo={Demo} prev={CHAPTERS[index - 1]} next={CHAPTERS[index + 1]} onSelect={select} />
      {index === CHAPTERS.length - 1 ? (
        <section aria-label="Next step" className="flex flex-wrap items-center justify-between gap-6 rounded-feature border border-line bg-surface p-6 sm:p-8">
          <div>
            <p className="font-display text-[1.75rem] font-bold leading-tight tracking-[-0.03em] sm:text-[2.25rem]">Now try it for real.</p>
            <p className="mt-2 text-muted">Pick testnet or mainnet in the header, then connect a wallet. Testnet tokens are free to mint.</p>
            <Link href="/docs" className={cn(SPACED_CAPS, "mt-4 inline-flex items-center gap-2 text-muted transition-colors duration-150 hover:text-text")}>
              Read the full docs
              <ArrowIcon />
            </Link>
          </div>
          <Link
            href="/perpetuals"
            className="inline-flex h-14 items-center justify-between gap-10 rounded-sharp bg-accent px-6 text-base font-medium text-accent-ink transition-[background-color,box-shadow] duration-150 hover:bg-accent-hover hover:shadow-[0_0_0_3px_var(--color-accent-line),var(--shadow-accent-glow)] active:bg-accent-press active:shadow-none"
          >
            Open App
            <ArrowIcon />
          </Link>
        </section>
      ) : null}
      <Reward chapters={CHAPTERS} onSelect={select} />
    </div>
  );
}

export function HowItWorks() {
  return <Lesson />;
}
