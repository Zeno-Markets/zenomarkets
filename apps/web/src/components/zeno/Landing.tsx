"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ContractCopyButton } from "@/components/ContractCopyButton";
import { Footer } from "@/components/Footer";
import { MarketLogo } from "@/components/MarketLogo";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { LISTED_CONTRACTS } from "@/lib/contracts";
import { networkName } from "@/lib/network";
import { X_URL } from "@/lib/social";
import { CLASS_LABEL, CLASS_ORDER, useCardMarkets, useSparks, type AssetClass, type CardMarket } from "./data";
import { fmtPct, fmtUsd, HeroCarousel } from "./HeroCarousel";
import { LendingWidget, OptionsWidget, PerpWidget } from "./widgets";

/// The landing page, laid out after an open, gridded reference: a rounded ink hero panel, white sections over
/// six visible column lines, soft grey bands, pill buttons and a poster-weight condensed face for the big titles.
/// The brand stays ZENOMARKETS lime on ink. The market card ring under the hero is its own component.

/* ---------- small pieces ---------- */

const FRAME = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";

function Arrow() {
  return (
    <svg aria-hidden viewBox="0 0 14 10" className="h-2.5 w-3.5 shrink-0 transition-transform duration-200 group-hover/cta:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M0 5h12M8 1l4 4-4 4" />
    </svg>
  );
}

/// The pill button of every call to action. `ink` is the solid black pill, `accent` the lime one, `outline` the
/// bordered white pill of "learn more" links, `paper` the light pill on an ink panel.
export function CtaLink({ href, children, variant = "ink", className = "" }: { href: string; children: ReactNode; variant?: "ink" | "accent" | "outline" | "paper"; className?: string }) {
  const look = {
    ink: "bg-ink text-paper hover:bg-accent hover:text-accent-ink",
    accent: "bg-accent text-accent-ink hover:bg-accent-hover hover:shadow-accent-glow",
    outline: "border border-line bg-raised text-text hover:border-text",
    paper: "border border-paper/30 text-paper hover:bg-paper hover:text-ink",
  }[variant];
  const external = href.startsWith("http");
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={`group/cta inline-flex h-11 items-center gap-3 rounded-full px-6 text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-200 active:scale-[0.98] ${look} ${className}`}
    >
      {children}
      <Arrow />
    </Link>
  );
}

function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[12px] uppercase tracking-[0.1em] text-text ${className}`}>{children}</p>;
}

function SectionHead({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-3 text-balance font-display text-[2.1rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.75rem]">{title}</h2>
      {children ? <p className="mx-auto mt-5 max-w-2xl text-balance text-[17px] leading-relaxed text-muted">{children}</p> : null}
    </div>
  );
}

function Sparkline({ closes, up, className = "" }: { closes: number[]; up: boolean; className?: string }) {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const d = closes.map((v, i) => `${i ? "L" : "M"}${((i / (closes.length - 1)) * 100).toFixed(2)},${(28 - ((v - min) / span) * 26).toFixed(2)}`).join("");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={d} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className={up ? "stroke-accent-fg" : "stroke-down"} />
    </svg>
  );
}

/// Reveal on first sight, once.
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && (setShown(true), io.disconnect()), { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`transition-[opacity,transform] duration-700 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ---------- hero ---------- */

/// Light rays fanning out of a vanishing point low in the panel: the hero's depth, drawn once as static polygons.
const RAYS = (() => {
  const vx = 640;
  const vy = 560;
  // Points round the top and right edges of a 1400 x 700 box, then a sparser fan to the left edge.
  const edge: [number, number][] = [];
  for (let x = 560; x <= 1400; x += 70) edge.push([x, 0]);
  for (let y = 70; y <= 700; y += 70) edge.push([1400, y]);
  const left: [number, number][] = [];
  for (let y = 120; y <= 640; y += 65) left.push([0, y]);
  const fan = (points: [number, number][]) =>
    points.slice(0, -1).map(([x, y], i) => {
      const [nx, ny] = points[i + 1]!;
      return `${vx},${vy} ${x},${y} ${(x + nx) / 2},${(y + ny) / 2}`;
    });
  return { vx, vy, right: fan(edge), left: fan(left) };
})();

function HeroRays() {
  return (
    <svg aria-hidden viewBox="0 0 1400 700" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
      <defs>
        <radialGradient id="hero-ray" cx={RAYS.vx} cy={RAYS.vy} r="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--color-lime)", stopOpacity: 0 }} />
          <stop offset="0.35" style={{ stopColor: "var(--color-lime)", stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: "var(--color-lime)", stopOpacity: 0.55 }} />
        </radialGradient>
      </defs>
      {RAYS.right.map((points) => (
        <polygon key={points} points={points} fill="url(#hero-ray)" />
      ))}
      {RAYS.left.map((points) => (
        <polygon key={points} points={points} fill="url(#hero-ray)" opacity="0.45" />
      ))}
    </svg>
  );
}

function Hero({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const classes = new Set(markets.map((m) => m.assetClass)).size;
  const maxLev = Math.max(...markets.map((m) => m.maxLeverage), 1);
  const stats = [
    { value: `${markets.length}`, label: "Markets live" },
    { value: `${classes}`, label: "Asset classes" },
    { value: `${maxLev}x`, label: "Max leverage" },
    { value: `${LISTED_CONTRACTS.length}`, label: "Contracts on chain" },
  ].filter((stat) => !/^0x?$/.test(stat.value));
  return (
    <section className="zeno-grid relative">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="theme-dark relative overflow-hidden rounded-[22px] bg-ink text-text sm:rounded-[28px]">
          <HeroRays />
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-ink)_15%,transparent_70%)]" />
          <div className="relative px-6 pb-16 pt-14 sm:px-12 sm:pb-20 sm:pt-20 lg:px-[7%] lg:pb-24 lg:pt-24">
            <Reveal>
              <p className="inline-flex items-center gap-2.5 rounded-full border border-line bg-ink/60 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted backdrop-blur">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-accent" />
                </span>
                Live on Robinhood Chain
              </p>
            </Reveal>
            <h1 className="mt-7 font-condensed text-[clamp(3.6rem,10vw,9rem)] font-extrabold uppercase leading-[0.84] tracking-[-0.01em]">
              <span className="block text-paper">One view.</span>
              <span className="block text-lime">A world of</span>
              <span className="block text-lime">markets.</span>
            </h1>
            <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-paper/85 sm:text-lg">
              Stocks, ETFs, crypto and commodities. Perps, options, lending and borrowing on Robinhood Chain, from one margin account.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <CtaLink href="/markets" variant="accent">
                Launch app
              </CtaLink>
              <CtaLink href="#products" variant="paper">
                Explore products
              </CtaLink>
            </div>
          </div>
        </div>
      </div>
      <div className="relative mt-6 sm:mt-8">
        <HeroCarousel markets={markets} sparks={sparks} />
      </div>
      <div className={`${FRAME} pb-16 sm:pb-20`}>
        <dl className="mx-auto grid max-w-4xl grid-cols-2 overflow-hidden rounded-panel border border-line bg-raised shadow-card sm:grid-cols-4">
          {stats.map((stat, i) => (
            <div key={stat.label} className={`flex flex-col-reverse gap-1 px-5 py-5 text-center ${i ? "sm:border-l sm:border-line" : ""} ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line sm:border-t-0" : ""}`}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{stat.label}</dt>
              <dd className="font-condensed text-4xl font-bold sm:text-5xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ---------- three products ---------- */

const ART_STROKE = "stroke-paper";

function ArtPerps() {
  const bars = [
    [40, 120, 70, 150],
    [80, 100, 60, 130],
    [120, 110, 80, 140],
    [160, 70, 50, 100],
    [200, 80, 40, 110],
    [240, 50, 25, 80],
    [280, 40, 20, 65],
  ];
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full">
      {bars.map(([x, top, high, low], i) => (
        <g key={x} className={ART_STROKE} strokeWidth="2">
          <line x1={x} x2={x} y1={high} y2={low! + 30} />
          <rect x={x! - 10} y={top} width="20" height={low! - top! + 10} rx="3" className={i % 3 === 1 ? "fill-ink" : "fill-paper"} />
        </g>
      ))}
      <path d="M20 190 C 90 170, 150 120, 300 30" fill="none" className="stroke-ink" strokeWidth="3" strokeDasharray="6 6" />
    </svg>
  );
}

function ArtOptions() {
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full">
      {[50, 90, 130, 170].map((y) => (
        <line key={y} x1="20" x2="300" y1={y} y2={y} className="stroke-paper/20" />
      ))}
      <path d="M20 150 H150 L300 30" fill="none" className="stroke-lime" strokeWidth="5" strokeLinejoin="round" />
      <path d="M150 150 L300 30 V150 Z" className="fill-lime/20" />
      <circle cx="150" cy="150" r="9" className="fill-ink stroke-lime" strokeWidth="3" />
      <line x1="150" x2="150" y1="30" y2="200" className="stroke-paper/50" strokeDasharray="4 5" />
    </svg>
  );
}

function ArtLending() {
  const coins = [0, 1, 2, 3, 4];
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full">
      {coins.map((i) => (
        <g key={i} transform={`translate(0 ${-i * 22})`}>
          <ellipse cx="120" cy="180" rx="62" ry="18" className="fill-ink stroke-paper" strokeWidth="2" />
          <path d="M58 180 v-12 a62 18 0 0 1 124 0 v12" className="fill-ink stroke-paper" strokeWidth="2" />
          <ellipse cx="120" cy="168" rx="62" ry="18" className="fill-accent stroke-ink" strokeWidth="2" />
        </g>
      ))}
      <rect x="210" y="60" width="80" height="110" rx="10" className="fill-paper stroke-ink" strokeWidth="2" />
      {[85, 105, 125].map((y) => (
        <line key={y} x1="225" x2="275" y1={y} y2={y} className="stroke-ink/40" strokeWidth="6" strokeLinecap="round" />
      ))}
    </svg>
  );
}

const PRODUCTS = [
  {
    id: "perps",
    title: "Long or short anything with a price",
    copy: "Up to 10x on index ETFs, 5x on blue chips and crypto. Market, limit, stop-loss and take-profit orders, isolated or cross margin.",
    href: "/perpetuals",
    cta: "Open perpetuals",
    art: <ArtPerps />,
    tone: "bg-[linear-gradient(165deg,var(--color-accent)_10%,var(--color-ink)_105%)]",
  },
  {
    id: "options",
    title: "Define the risk. Keep the upside",
    copy: "Cash-settled calls and puts with a live chain, Greeks and a strategy builder for spreads and straddles. The premium is your max loss.",
    href: "/options",
    cta: "Open options",
    art: <ArtOptions />,
    tone: "bg-[linear-gradient(165deg,var(--color-ink)_35%,color-mix(in_srgb,var(--color-lime)_55%,var(--color-ink))_115%)]",
  },
  {
    id: "lending",
    title: "Borrow against your stocks",
    copy: "Lock tokenized shares as collateral and draw USDG up to a fixed loan-to-value limit. Interest accrues per block, the shares stay yours.",
    href: "/lending",
    cta: "Open lending",
    art: <ArtLending />,
    tone: "bg-[linear-gradient(165deg,var(--color-paper)_0%,var(--color-accent)_95%)]",
  },
];

function ProductTrio() {
  return (
    <section id="products" className="zeno-grid relative pb-20 sm:pb-28">
      <div className={`${FRAME} grid gap-6 md:grid-cols-3 lg:gap-10`}>
        {PRODUCTS.map((item, i) => (
          <Reveal key={item.id} delay={i * 90}>
            <article id={item.id} className="flex h-full flex-col rounded-[20px] bg-raised p-3 shadow-card transition-transform duration-300 hover:-translate-y-1">
              <div className={`relative aspect-[4/3.4] overflow-hidden rounded-[14px] ${item.tone}`}>
                <div className="absolute inset-0 p-6">{item.art}</div>
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(to_top,var(--color-ink),transparent)] opacity-60" />
              </div>
              <div className="flex flex-1 flex-col px-2 pb-3 pt-5">
                <h3 className="font-condensed text-[2rem] font-bold leading-[0.95] tracking-[-0.005em]">{item.title}</h3>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-muted">{item.copy}</p>
                <CtaLink href={item.href} variant="outline" className="mt-6 h-10 self-start px-5 text-[13px]">
                  {item.cta}
                </CtaLink>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------- market constellation ---------- */

// Positions (percent of the stage) for market tiles around the centre frame, and for the small lime squares.
const SPOTS: [number, number][] = [
  [17, 8], [44, 3], [68, 9], [86, 19], [6, 33], [29, 21], [78, 37], [94, 52], [11, 61], [26, 77], [72, 72], [88, 85], [41, 91], [59, 95],
];
const DOTS: [number, number][] = [
  [35, 12], [56, 15], [22, 45], [82, 58], [8, 84], [95, 32], [64, 82], [32, 96], [50, 5],
];

function Constellation({ markets }: { markets: CardMarket[] }) {
  const tiles = markets.slice(0, SPOTS.length);
  const frame = (
    <div className="relative mx-auto flex aspect-square w-full max-w-[400px] flex-col items-center justify-center px-10 text-center [clip-path:polygon(18%_0,82%_0,100%_18%,100%_82%,82%_100%,18%_100%,0_82%,0_18%)]">
      <div aria-hidden className="absolute inset-0 bg-accent-fg [clip-path:polygon(18%_0,82%_0,100%_18%,100%_82%,82%_100%,18%_100%,0_82%,0_18%)]" />
      <div aria-hidden className="absolute inset-[3px] bg-ground [clip-path:polygon(18%_0,82%_0,100%_18%,100%_82%,82%_100%,18%_100%,0_82%,0_18%)]" />
      <p className="relative text-balance font-display text-xl font-medium leading-snug tracking-[-0.02em] sm:text-[1.4rem]">
        Trade {markets.length} markets across stocks, ETFs, crypto and commodities from one margin account.
      </p>
      <CtaLink href="/markets" variant="outline" className="relative mt-6 h-10 px-5 text-[13px]">
        Explore markets
      </CtaLink>
    </div>
  );
  return (
    <section aria-label="Markets on ZENOMARKETS" className="zeno-grid relative overflow-hidden py-10 sm:py-16">
      <div className={`${FRAME} relative hidden h-[760px] lg:block`}>
        {DOTS.map(([x, y]) => (
          <span key={`${x}-${y}`} aria-hidden className="absolute size-3.5 rotate-45 rounded-[3px] bg-accent" style={{ left: `${x}%`, top: `${y}%` }} />
        ))}
        {tiles.map((market, i) => {
          const [x, y] = SPOTS[i]!;
          return (
            <Link
              key={market.symbol}
              href={`/perpetuals?market=${market.symbol}`}
              className="zeno-float group absolute flex -translate-x-1/2 flex-col items-center gap-2"
              style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${(i % 5) * -1.2}s` }}
            >
              <span className="grid size-14 place-items-center rounded-2xl bg-raised shadow-card ring-1 ring-line transition-transform duration-200 group-hover:scale-110">
                <MarketLogo symbol={market.symbol} className="size-9!" />
              </span>
              <span className="text-xs font-medium">{market.symbol}</span>
            </Link>
          );
        })}
        <div className="absolute left-1/2 top-1/2 w-[400px] -translate-x-1/2 -translate-y-1/2">{frame}</div>
      </div>
      <div className={`${FRAME} lg:hidden`}>
        {frame}
        <ul className="mt-10 flex flex-wrap justify-center gap-4">
          {tiles.map((market) => (
            <li key={market.symbol}>
              <Link href={`/perpetuals?market=${market.symbol}`} className="flex flex-col items-center gap-1.5">
                <span className="grid size-12 place-items-center rounded-2xl bg-raised shadow-card ring-1 ring-line">
                  <MarketLogo symbol={market.symbol} className="size-8!" />
                </span>
                <span className="text-[11px] font-medium">{market.symbol}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- the onchain standard ---------- */

function ArtGrid() {
  const dots: [number, number][] = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if ((r + c) % 2 === 0) dots.push([30 + c * 20, 30 + r * 20]);
  return (
    <svg aria-hidden viewBox="0 0 200 200" className="size-full" fill="none">
      <rect x="10" y="10" width="180" height="180" rx="22" className="stroke-current" strokeWidth="2.5" />
      {dots.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width="8" height="8" rx="2" className="fill-current" />
      ))}
    </svg>
  );
}

function ArtFan() {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className="size-full" fill="none">
      <rect x="40" y="10" width="120" height="120" rx="18" className="stroke-current" strokeWidth="2.5" />
      {[20, 55, 100, 145, 180].map((x) => (
        <g key={x}>
          <line x1="100" y1="60" x2={x} y2="180" className="stroke-current" strokeWidth="2" />
          <rect x={x - 6} y="174" width="12" height="12" rx="3" className="fill-current" />
        </g>
      ))}
      <rect x="93" y="53" width="14" height="14" rx="3" className="fill-current" />
    </svg>
  );
}

function ArtStack() {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className="size-full" fill="none">
      {[50, 100, 150].map((x) => (
        <line key={x} x1={x} x2={x} y1="0" y2="45" className="stroke-current" strokeWidth="2.5" strokeDasharray="6 6" />
      ))}
      <path d="M100 55 L170 85 L100 115 L30 85 Z" className="stroke-current" strokeWidth="2.5" />
      <path d="M30 85 V160 L100 190 L170 160 V85" className="stroke-current" strokeWidth="2.5" />
      <path d="M30 122 L100 152 L170 122" className="stroke-current" strokeWidth="2.5" />
      <line x1="100" x2="100" y1="115" y2="190" className="stroke-current" strokeWidth="2.5" />
    </svg>
  );
}

function OnchainStandard({ markets }: { markets: CardMarket[] }) {
  const maxLev = Math.max(...markets.map((m) => m.maxLeverage), 1);
  const items = [
    { art: <ArtGrid />, value: `${markets.length}`, label: "Markets live", source: "/markets", copy: "Stocks, ETFs, crypto and commodities, each priced by an oracle and settled in USDG." },
    { art: <ArtFan />, value: `${maxLev}x`, label: "Max leverage", source: "/docs#parameters", copy: "One vault margins every position, so a single deposit reaches every market." },
    { art: <ArtStack />, value: `${LISTED_CONTRACTS.length}`, label: "Contracts on chain", source: "/docs#verify", copy: "Every contract sits behind an ERC-1967 proxy and is open on the explorer." },
  ];
  return (
    <section className="relative bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead title="The onchain standard">
          Prices from Chainlink behind a staleness and deviation guard, margin in one vault, settlement by contracts anyone can read. Check every number yourself.
        </SectionHead>
        <div className="mt-16 grid gap-14 md:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.label} delay={i * 90} className="text-center">
              <div className="mx-auto size-44 text-accent-fg sm:size-52">{item.art}</div>
              <p className="mt-8 font-display text-xl font-medium tracking-[-0.02em]">
                <span className="rounded-[4px] bg-accent px-1.5 text-accent-ink">{item.value}</span> {item.label}
              </p>
              <Link href={item.source} className="mt-4 inline-block text-xs text-muted underline underline-offset-4 hover:text-text">
                Source
              </Link>
              <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted">{item.copy}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-14 flex justify-center">
          <CtaLink href="/markets">View live data</CtaLink>
        </div>
      </div>
    </section>
  );
}

/* ---------- hands-on products ---------- */

function HandsOn({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const pick = (preferred: string[]) => {
    for (const symbol of preferred) {
      const m = markets.find((x) => x.symbol === symbol);
      if (m && sparks?.[symbol]) return { market: m, price: sparks[symbol]!.price };
    }
    const m = markets.find((x) => sparks?.[x.symbol]);
    return m ? { market: m, price: sparks![m.symbol]!.price } : undefined;
  };
  const perp = pick(["BTC", "NVDA", "SPY"]);
  const option = pick(["NVDA", "TSLA", "AAPL"]);
  const cards = [
    {
      tag: "Perpetuals",
      copy: "Set a side and a leverage and watch the outcome across prices. Oracle mark price, limit, stop and take-profit orders, cross or isolated margin.",
      href: "/perpetuals",
      cta: "Learn about perps",
      tone: "bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_45%,var(--color-surface)))]",
      widget: perp ? <PerpWidget symbol={perp.market.symbol} price={perp.price} maxLeverage={perp.market.maxLeverage} /> : null,
    },
    {
      tag: "Options",
      copy: "Pick a strike and see the payoff at expiry. Weekly and monthly expiries, Greeks on every strike and a strategy builder, settled in USDG.",
      href: "/options",
      cta: "Learn about options",
      tone: "bg-[linear-gradient(135deg,var(--color-ink),color-mix(in_srgb,var(--color-lime)_35%,var(--color-ink)))]",
      widget: option ? <OptionsWidget symbol={option.market.symbol} price={option.price} /> : null,
    },
  ];
  return (
    <section className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead eyebrow="One margin account" title="Trade it, hedge it, see it first">
          Every product draws on the same USDG balance. Try the numbers here, priced from a live market; nothing is signed.
        </SectionHead>
        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          {cards.map((card) => (
            <Reveal key={card.tag}>
              <div className={`rounded-[18px] p-4 sm:p-6 ${card.tone}`}>
                <div className="rounded-[14px] bg-raised p-4 shadow-lift sm:p-5">{card.widget ?? <div className="h-[420px] animate-pulse rounded-panel bg-surface" />}</div>
              </div>
              <Eyebrow className="mt-6">{card.tag}</Eyebrow>
              <p className="mt-3 text-pretty text-lg leading-snug sm:text-xl">{card.copy}</p>
              <CtaLink href={card.href} variant="outline" className="mt-5 h-10 px-5 text-[13px]">
                {card.cta}
              </CtaLink>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- roadmap ---------- */

const ROADMAP = [
  { tag: "Testnet", title: "Every feature, live", items: ["Perps, options, RFQ", "Lending & borrowing", "Copy trading, leaderboard, PnL cards", "21 markets across four asset classes"], now: true },
  { tag: "V1.0", title: "Mainnet: the trading core", items: ["Perpetuals and options on mainnet", "Stocks, ETFs, crypto, commodities", "Portfolio, leaderboard, PnL cards"] },
  { tag: "V2.0", title: "Capital", items: ["Stock-backed USDG loans", "Subaccounts", "Copy trading", "RFQ block trades"] },
  { tag: "V3.0", title: "ZENO", items: ["ZENO token", "Fee-funded buyback", "Holder alignment with venue revenue"] },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead eyebrow="Roadmap" title="Shipped in versions, each one on chain">
          The testnet runs every feature today. Mainnet opens in stages, so each release can be checked before the next.
        </SectionHead>
      </div>
      <ol className="mt-14 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 sm:px-8 lg:justify-center">
        {ROADMAP.map((step, i) => (
          <li key={step.tag} className="w-[280px] shrink-0 snap-start overflow-hidden rounded-[16px] bg-raised shadow-card sm:w-[300px]">
            <div className={`theme-dark relative h-36 overflow-hidden ${step.now ? "bg-[linear-gradient(135deg,var(--color-ink)_30%,color-mix(in_srgb,var(--color-lime)_70%,var(--color-ink)))]" : "bg-ink"}`}>
              <div aria-hidden className="zeno-grid-dark absolute inset-0" />
              <div className="relative flex h-full flex-col justify-between p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-ink">{step.now ? "Live now" : `Step 0${i}`}</span>
                  <span className="font-mono text-[11px] text-muted">ZENOMARKETS</span>
                </div>
                <span className="font-condensed text-5xl font-extrabold uppercase italic text-paper">{step.tag}</span>
              </div>
            </div>
            <div className="p-5">
              <p className="font-display text-lg font-medium tracking-[-0.02em]">{step.title}</p>
              <ul className="mt-3 space-y-2">
                {step.items.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm text-muted">
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-[1px] bg-accent-fg" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- markets explorer ---------- */

function MarketsExplorer({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const present = CLASS_ORDER.filter((c) => markets.some((m) => m.assetClass === c));
  const [tab, setTab] = useState<AssetClass>("stock");
  const rows = markets.filter((m) => m.assetClass === tab && sparks?.[m.symbol]).slice(0, 8);
  return (
    <section id="markets" className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead title="Wall Street, the chain and the commodity pit">
          Every market settles in USDG against one vault. Switch from Nvidia to Bitcoin to gold without moving funds, bridging or opening another app.
        </SectionHead>
        <div className="mt-8 flex flex-wrap justify-center gap-3" role="tablist" aria-label="Asset classes">
          {present.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              aria-selected={tab === c}
              onClick={() => setTab(c)}
              className={`h-10 min-w-[7.5rem] rounded-full px-5 text-sm transition-[background-color,color,box-shadow,border-color] duration-200 ${tab === c ? "bg-accent text-accent-ink shadow-accent-glow" : "border border-line bg-raised text-muted hover:border-text hover:text-text"}`}
            >
              {CLASS_LABEL[c]}s <span className="ml-1 opacity-60">{markets.filter((m) => m.assetClass === c).length}</span>
            </button>
          ))}
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.length === 0
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className="h-56 animate-pulse rounded-[16px] bg-surface" />)
            : rows.map((row) => {
                const s = sparks![row.symbol]!;
                const up = s.changePct >= 0;
                return (
                  <Link key={row.symbol} href={`/perpetuals?market=${row.symbol}`} className="group flex h-full flex-col rounded-[16px] bg-surface p-5 transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-raised hover:shadow-card">
                    <div className="flex items-start justify-between">
                      <MarketLogo symbol={row.symbol} className="size-10! rounded-[10px]!" />
                      <span className="inline-flex items-center gap-2 text-xs text-muted transition-colors group-hover:text-text">
                        Trade
                        <span className="grid size-6 place-items-center rounded-[6px] border border-line transition-colors group-hover:border-accent-fg group-hover:bg-accent group-hover:text-accent-ink">
                          <Arrow />
                        </span>
                      </span>
                    </div>
                    <p className="mt-6 text-lg font-medium">{row.symbol}</p>
                    <p className="truncate text-sm text-muted">{row.name}</p>
                    <Sparkline closes={s.closes} up={up} className="mt-4 h-10 w-full" />
                    <p className="mt-3 flex items-baseline justify-between font-mono text-sm tabular-nums">
                      {fmtUsd(s.price)} <span className={up ? "text-up" : "text-down"}>{fmtPct(s.changePct)}</span>
                    </p>
                  </Link>
                );
              })}
        </div>
        <div className="mt-12 flex justify-center">
          <CtaLink href="/markets" variant="outline" className="h-10 px-5 text-[13px]">
            View all markets
          </CtaLink>
        </div>
      </div>
    </section>
  );
}

/* ---------- ready ---------- */

function Ready() {
  return (
    <section className="zeno-grid relative pb-16 pt-4 text-center sm:pb-20">
      <h2 className="font-display text-[1.9rem] font-medium tracking-[-0.03em] sm:text-[2.4rem]">Ready to trade on ZENOMARKETS?</h2>
      <div className="mt-6 flex justify-center">
        <CtaLink href="/markets">Launch app</CtaLink>
      </div>
    </section>
  );
}

/* ---------- contracts ---------- */

const MODULES = [
  { name: "Vault", detail: "ZenoVault · ZenoCollateralManager", match: ["ZenoVault", "ZenoCollateralManager", "ZenoInsuranceFund"] },
  { name: "Perps", detail: "ZenoPerpsEngine · orders · funding", match: ["ZenoPerpsEngine", "ZenoPerpPositionManager", "ZenoPerpOrderManager", "ZenoFundingManager", "ZenoLiquidationEngine", "ZenoRFQManager"] },
  { name: "Options", detail: "ZenoOptionsEngine · ZenoOptionMarket", match: ["ZenoOptionsEngine", "ZenoOptionMarket", "ZenoOptionPositionManager"] },
  { name: "Oracle", detail: "ZenoOracleRouter · ZenoPriceValidator", match: ["ZenoOracleRouter", "ZenoPriceValidator", "ZenoCompositeSanityOracle"] },
  { name: "Risk", detail: "ZenoRiskManager · cross margin", match: ["ZenoRiskManager", "ZenoCrossMarginManager", "ZenoMarketRegistry", "ZenoFeeManager", "ZenoBuybackModule", "ZenoSubaccountFactory"] },
  { name: "Credit", detail: "ZenoCreditPair · ZenoCreditVault", match: ["ZenoCreditPair", "ZenoCreditVault", "ZenoCreditRegistry", "ZenoCreditRouter"] },
];

function Contracts() {
  const [focus, setFocus] = useState<string | null>(null);
  const highlighted = useMemo(() => new Set(MODULES.find((m) => m.name === focus)?.match ?? []), [focus]);
  const rows = LISTED_CONTRACTS;
  return (
    <section id="contracts" className="zeno-grid relative pb-20 sm:pb-28">
      <div className="px-3 sm:px-6">
        <div className="mx-auto grid max-w-[1400px] items-center gap-10 overflow-hidden rounded-[22px] bg-[linear-gradient(180deg,var(--color-accent)_0%,color-mix(in_srgb,var(--color-accent)_35%,var(--color-surface))_100%)] px-6 py-12 text-accent-ink sm:px-12 sm:py-16 lg:grid-cols-2 lg:px-16">
          <div>
            <div className="iso-stage mx-auto" onMouseLeave={() => setFocus(null)}>
              {MODULES.map((module, i) => (
                <button
                  key={module.name}
                  type="button"
                  onMouseEnter={() => setFocus(module.name)}
                  onFocus={() => setFocus(module.name)}
                  onClick={() => setFocus(focus === module.name ? null : module.name)}
                  className={`iso-cube ${focus === module.name ? "is-on" : ""}`}
                  style={{ "--c": i % 3, "--r": Math.floor(i / 3) } as CSSProperties}
                  aria-label={`${module.name}: ${module.detail}`}
                >
                  <span className="iso-top" />
                  <span className="iso-left" />
                  <span className="iso-right" />
                  <span className="iso-label">{module.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 h-5 text-center font-mono text-xs">{focus ? MODULES.find((m) => m.name === focus)?.detail : "Six modules · one vault · one oracle path"}</p>
          </div>
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.1em]">Verified on chain</p>
            <h2 className="mt-3 font-display text-[2.1rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.6rem]">{rows.length} contracts. Every one on the explorer.</h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed">Six modules, each behind an ERC-1967 proxy. Hover a block to light up its contracts; open any address on Blockscout.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <CtaLink href="/docs#verify" className="h-10 px-5 text-[13px]">
                Verify it yourself
              </CtaLink>
            </div>
            <details className="group mt-6 overflow-hidden rounded-[14px] bg-raised text-text shadow-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <span>All contracts · {networkName(env.chainId)}</span>
                <span aria-hidden className="transition-transform group-open:rotate-45">+</span>
              </summary>
              <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
                {rows.map((row) => {
                  const url = explorerAddressUrl(env.explorerUrl, row.address);
                  const lit = highlighted.has(row.contract);
                  return (
                    <li key={row.address} className={`flex items-center justify-between gap-3 px-5 py-2.5 transition-colors duration-200 ${lit ? "bg-accent-soft" : ""}`}>
                      <div className="min-w-0">
                        <p className="truncate font-mono text-[13px] font-medium">{row.contract}</p>
                        <p className="truncate text-xs text-muted">{row.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="rounded-full px-2 py-1 font-mono text-xs text-muted transition-colors hover:bg-ink hover:text-paper">
                            {row.address.slice(0, 6)}…{row.address.slice(-4)} ↗
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-muted">
                            {row.address.slice(0, 6)}…{row.address.slice(-4)}
                          </span>
                        )}
                        <ContractCopyButton address={row.address} label={row.contract} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- closing ---------- */

function Closing({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const lend = markets.find((m) => m.symbol === "TSLA" && sparks?.TSLA) ?? markets.find((m) => sparks?.[m.symbol]);
  const actions = [
    { href: "/markets", label: "Launch app", look: "bg-accent text-accent-ink shadow-accent-glow hover:bg-accent-hover" },
    { href: "/docs", label: "Read the docs", look: "bg-raised hover:bg-ink hover:text-paper" },
    { href: X_URL, label: "Follow @UseZenoMarkets", look: "bg-raised hover:bg-ink hover:text-paper" },
  ];
  return (
    <section className="relative overflow-hidden bg-surface py-20 sm:py-24">
      <div className={`${FRAME} grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <div className="relative flex justify-center">
          <div aria-hidden className="absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/40 blur-[90px]" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/zeno-glass.png" alt="" width={320} height={320} className="zeno-float relative h-56 w-56 sm:h-72 sm:w-72" />
        </div>
        <div className="flex flex-col gap-4">
          {actions.map((action) => {
            const external = action.href.startsWith("http");
            return (
              <Link
                key={action.label}
                href={action.href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
                className={`group/cta flex h-20 items-center justify-between rounded-[22px] px-6 font-display text-2xl font-medium tracking-[-0.02em] transition-[background-color,color,transform] duration-200 hover:-translate-y-0.5 sm:h-24 sm:text-3xl ${action.look}`}
              >
                {action.label}
                <Arrow />
              </Link>
            );
          })}
          {lend && sparks ? (
            <details className="rounded-[22px] bg-raised">
              <summary className="flex h-20 cursor-pointer list-none items-center justify-between px-6 font-display text-2xl font-medium tracking-[-0.02em] sm:h-24 sm:text-3xl">
                Try a stock-backed loan
                <span aria-hidden className="text-muted">+</span>
              </summary>
              <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                <LendingWidget symbol={lend.symbol} price={sparks[lend.symbol]!.price} />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  const markets = useCardMarkets();
  return (
    <>
      <Hero markets={markets} />
      <ProductTrio />
      <Constellation markets={markets} />
      <OnchainStandard markets={markets} />
      <HandsOn markets={markets} />
      <MarketsExplorer markets={markets} />
      <Roadmap />
      <Ready />
      <Contracts />
      <Closing markets={markets} />
      <Footer />
    </>
  );
}
