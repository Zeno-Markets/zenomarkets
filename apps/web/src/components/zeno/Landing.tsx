"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Spark } from "@/app/api/spark/route";
import { ContractCopyButton } from "@/components/ContractCopyButton";
import { CountUp } from "@/components/CountUp";
import { Footer } from "@/components/Footer";
import { MarketLogo } from "@/components/MarketLogo";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { LISTED_CONTRACTS } from "@/lib/contracts";
import { networkName } from "@/lib/network";
import { X_URL } from "@/lib/social";
import { CLASS_LABEL, CLASS_ORDER, useCardMarkets, useSparks, type AssetClass, type CardMarket } from "./data";
import { LetterHover, Magnetic, SectionRail, Tilt, pointerVars, resetPointerVars } from "./fx";
import { fmtPct, fmtUsd, HeroCarousel } from "./HeroCarousel";
import { LogoOrb, OrbSlot, type OrbShape } from "./LogoOrb";
import { LendingWidget, OptionsWidget, PerpWidget } from "./widgets";

/// The landing page, laid out after an open, gridded reference: a rounded ink hero panel, white sections over
/// six visible column lines, soft grey bands, pill buttons and a poster-weight condensed face for the big titles.
/// The brand stays ZENOMARKETS lime on ink. The hero is short enough that the market card ring shows on the first
/// screen. A 3D voxel logo (LogoOrb) travels down the page, docking into one `OrbSlot` per section and rebuilding
/// itself into that section's shape; every section also answers the pointer in its own way.

/* ---------- small pieces ---------- */

const FRAME = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";

const RAIL = [
  { id: "top", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "universe", label: "Markets" },
  { id: "standard", label: "Onchain" },
  { id: "try", label: "Try it" },
  { id: "markets", label: "Explore" },
  { id: "roadmap", label: "Roadmap" },
  { id: "contracts", label: "Contracts" },
  { id: "start", label: "Start" },
];

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

/// A centred section title. With `orb`, the section's docking box for the 3D logo sits beside it on wide screens and
/// above it on narrow ones.
function SectionHead({ eyebrow, title, children, orb }: { eyebrow?: string; title: ReactNode; children?: ReactNode; orb?: { shape: OrbShape; side: "left" | "right" } }) {
  return (
    <div className="relative">
      {orb ? <OrbSlot shape={orb.shape} className={`mx-auto mb-6 size-28 sm:size-32 xl:absolute xl:top-1/2 xl:mb-0 xl:size-48 xl:-translate-y-1/2 ${orb.side === "left" ? "xl:left-0" : "xl:right-0"}`} /> : null}
      <div className="mx-auto max-w-3xl text-center">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2 className="mt-3 text-balance font-display text-[2.1rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.75rem]">{title}</h2>
        {children ? <p className="mx-auto mt-5 max-w-2xl text-balance text-[17px] leading-relaxed text-muted">{children}</p> : null}
      </div>
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

/// Reveal on first sight, once. Adds `is-shown`, which line art inside reads to draw itself.
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
    <div ref={ref} className={`transition-[opacity,transform] duration-700 ease-out ${shown ? "is-shown translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const pricedFirst = (markets: CardMarket[], sparks: Record<string, Spark> | undefined, preferred: string[]) => {
  const chosen = preferred.map((symbol) => markets.find((m) => m.symbol === symbol)).filter((m): m is CardMarket => Boolean(m && sparks?.[m.symbol]));
  return chosen.length ? chosen : markets.filter((m) => sparks?.[m.symbol]).slice(0, 4);
};

/* ---------- hero ---------- */

/// Light rays fanning out of a vanishing point low in the panel: the hero's depth, drawn once as static polygons.
const RAYS = (() => {
  const vx = 640;
  const vy = 560;
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

/// The live badge: cycles through the priced markets, one quote every few seconds, and opens the one on show.
function LiveBadge({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const reduced = useReducedMotion();
  const priced = markets.filter((m) => sparks?.[m.symbol]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced || priced.length < 2) return;
    const id = setInterval(() => setN((v) => v + 1), 2600);
    return () => clearInterval(id);
  }, [reduced, priced.length]);
  const market = priced.length ? priced[n % priced.length] : undefined;
  const spark = market ? sparks?.[market.symbol] : undefined;
  return (
    <Link
      href={market ? `/perpetuals?market=${market.symbol}` : "/markets"}
      className="inline-flex items-center gap-2.5 rounded-full border border-line bg-ink/60 py-1.5 pl-3.5 pr-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted backdrop-blur transition-colors duration-200 hover:border-accent hover:text-text"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-accent" />
      </span>
      <span>
        Live<span className="max-sm:hidden"> on Robinhood Chain</span>
      </span>
      {market && spark ? (
        <span key={market.symbol} className="card-in inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-2.5 py-0.5 tracking-normal text-paper">
          <span className="font-semibold">{market.symbol}</span>
          <span className="normal-case">{fmtUsd(spark.price)}</span>
          <span className={spark.changePct >= 0 ? "text-lime" : "text-coral"}>{fmtPct(spark.changePct)}</span>
        </span>
      ) : null}
    </Link>
  );
}

function Hero({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const classes = new Set(markets.map((m) => m.assetClass)).size;
  const maxLev = Math.max(...markets.map((m) => m.maxLeverage), 1);
  const stats = [
    { value: markets.length, format: (n: number) => `${Math.round(n)}`, label: "Markets live" },
    { value: classes, format: (n: number) => `${Math.round(n)}`, label: "Asset classes" },
    { value: maxLev, format: (n: number) => `${Math.round(n)}x`, label: "Max leverage" },
    { value: LISTED_CONTRACTS.length, format: (n: number) => `${Math.round(n)}`, label: "Contracts on chain" },
  ].filter((stat) => stat.value > 0);
  return (
    <section id="top" className="zeno-grid relative">
      <div className="px-3 pt-3 sm:px-4 sm:pt-4">
        <div onPointerMove={pointerVars} onPointerLeave={resetPointerVars} className="theme-dark group/hero relative overflow-hidden rounded-[22px] bg-ink text-text sm:rounded-[28px]">
          <div className="absolute -inset-[4%] transition-transform duration-700 ease-out" style={{ transform: "translate3d(calc((var(--px, 0.5) - 0.5) * -40px), calc((var(--py, 0.5) - 0.5) * -26px), 0)" }}>
            <HeroRays />
          </div>
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-ink)_22%,transparent_78%)]" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/hero:opacity-100"
            style={{ background: "radial-gradient(460px circle at calc(var(--px, 0.5) * 100%) calc(var(--py, 0.5) * 100%), color-mix(in srgb, var(--color-lime) 13%, transparent), transparent 70%)" }}
          />
          <OrbSlot shape="logo" className="absolute right-4 top-4 size-16 sm:right-6 sm:top-6 sm:size-20 lg:hidden" />
          <div className="relative grid px-6 pb-10 pt-6 sm:px-12 sm:pb-12 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.5fr)] lg:gap-10 lg:px-[6%] lg:pt-12">
            <div>
              <LiveBadge markets={markets} />
              <h1 className="mt-7 font-condensed text-[clamp(2.9rem,5.4vw,6rem)] font-extrabold uppercase leading-[0.86] sm:mt-8">
                <span className="sr-only">One view. A world of markets.</span>
                <LetterHover text="One view." className="block text-paper" hover="hover:text-lime" />
                <LetterHover text="A world of markets." className="block text-lime" hover="hover:text-paper" />
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-paper/85 sm:mt-6 sm:text-[17px]">
                Stocks, ETFs, crypto and commodities. Perps, options, lending and borrowing on Robinhood Chain, from one margin account.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8">
                <Magnetic>
                  <CtaLink href="/markets" variant="accent" className="max-sm:px-5">
                    Launch app
                  </CtaLink>
                </Magnetic>
                <Magnetic>
                  <CtaLink href="#products" variant="paper" className="max-sm:px-5">
                    Explore products
                  </CtaLink>
                </Magnetic>
              </div>
            </div>
            <OrbSlot shape="logo" className="hidden min-h-[280px] lg:block" />
          </div>
        </div>
      </div>
      {/* The ring's canvas carries empty space above the cards: tuck it up under the panel and clip that strip, so the
          cards show on the first screen and the ring's edge blur never touches the panel. */}
      <div className="relative -mt-12 [clip-path:inset(48px_0_0_0)]">
        <HeroCarousel markets={markets} sparks={sparks} />
      </div>
      <div className={`${FRAME} pb-16 sm:pb-20`}>
        <dl className="mx-auto grid max-w-4xl grid-cols-2 overflow-hidden rounded-panel border border-line bg-raised shadow-card sm:grid-cols-4">
          {stats.map((stat, i) => (
            <div key={stat.label} className={`group flex flex-col-reverse gap-1 px-5 py-5 text-center transition-colors duration-300 hover:bg-accent-soft ${i ? "sm:border-l sm:border-line" : ""} ${i % 2 ? "border-l border-line" : ""} ${i > 1 ? "border-t border-line sm:border-t-0" : ""}`}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{stat.label}</dt>
              <dd className="font-condensed text-4xl font-bold transition-transform duration-300 group-hover:-translate-y-0.5 sm:text-5xl">
                <CountUp value={stat.value} format={stat.format} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ---------- three products ---------- */

function ArtPerps() {
  const bars: [number, number, number, number][] = [
    [40, 120, 70, 150],
    [80, 100, 60, 130],
    [120, 110, 80, 140],
    [160, 70, 50, 100],
    [200, 80, 40, 110],
    [240, 50, 25, 80],
    [280, 40, 20, 65],
  ];
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full overflow-visible">
      {bars.map(([x, top, high, low], i) => (
        <g key={x} className="stroke-paper transition-[translate] duration-500 ease-out group-hover/card:[translate:0_var(--lift)]" strokeWidth="2" style={{ "--lift": `${-6 - i * 3}px`, transitionDelay: `${i * 45}ms` } as CSSProperties}>
          <line x1={x} x2={x} y1={high} y2={low + 30} />
          <rect x={x - 10} y={top} width="20" height={low - top + 10} rx="3" className={i % 3 === 1 ? "fill-ink" : "fill-paper"} />
        </g>
      ))}
      <path d="M20 190 C 90 170, 150 120, 300 30" fill="none" className="stroke-ink transition-[stroke-dashoffset] duration-[1400ms] ease-out group-hover/card:[stroke-dashoffset:-72]" strokeWidth="3" strokeDasharray="6 6" />
    </svg>
  );
}

function ArtOptions() {
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full overflow-visible">
      {[50, 90, 130, 170].map((y) => (
        <line key={y} x1="20" x2="300" y1={y} y2={y} className="stroke-paper/20" />
      ))}
      <path d="M150 150 L300 30 V150 Z" className="fill-lime/20 transition-opacity duration-500 group-hover/card:opacity-100 opacity-60" />
      <path d="M20 150 H150 L300 30" fill="none" pathLength={1} className="stroke-lime [stroke-dasharray:1] group-hover/card:[animation:draw-line_1.1s_ease-out]" strokeWidth="5" strokeLinejoin="round" />
      <line x1="150" x2="150" y1="30" y2="200" className="stroke-paper/50" strokeDasharray="4 5" />
      <circle cx="150" cy="150" r="9" className="svg-move fill-ink stroke-lime transition-transform duration-300 group-hover/card:scale-150" strokeWidth="3" />
    </svg>
  );
}

function ArtLending() {
  return (
    <svg aria-hidden viewBox="0 0 320 220" className="size-full overflow-visible">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(0 ${-i * 22})`}>
          <g className="transition-[translate] duration-500 ease-out group-hover/card:[translate:0_var(--lift)]" style={{ "--lift": `${-i * 9}px`, transitionDelay: `${i * 50}ms` } as CSSProperties}>
            <ellipse cx="120" cy="180" rx="62" ry="18" className="fill-ink stroke-paper" strokeWidth="2" />
            <path d="M58 180 v-12 a62 18 0 0 1 124 0 v12" className="fill-ink stroke-paper" strokeWidth="2" />
            <ellipse cx="120" cy="168" rx="62" ry="18" className="fill-accent stroke-ink" strokeWidth="2" />
          </g>
        </g>
      ))}
      <g className="transition-[translate] duration-500 ease-out group-hover/card:[translate:10px_-6px]">
        <rect x="210" y="60" width="80" height="110" rx="10" className="fill-paper stroke-ink" strokeWidth="2" />
        {[85, 105, 125].map((y, i) => (
          <line key={y} x1="225" x2="275" y1={y} y2={y} pathLength={1} className="stroke-ink/40 [stroke-dasharray:1] group-hover/card:[animation:draw-line_0.8s_ease-out_backwards]" style={{ animationDelay: `${i * 120}ms` }} strokeWidth="6" strokeLinecap="round" />
        ))}
      </g>
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
      <div className={FRAME}>
        <div className="mb-10 flex items-center gap-6 sm:mb-14 sm:gap-14">
          <OrbSlot shape="cards" className="size-24 shrink-0 sm:size-36 lg:size-44" />
          <div>
            <Eyebrow>Three products</Eyebrow>
            <h2 className="mt-3 max-w-2xl text-balance font-display text-[1.8rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.6rem]">One margin account. Every way to move.</h2>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-3 lg:gap-10">
          {PRODUCTS.map((item, i) => (
            <Reveal key={item.id} delay={i * 90} className="h-full">
              <Tilt className="h-full">
                <article id={item.id} className="group/card relative flex h-full flex-col rounded-[20px] bg-raised p-3 shadow-card transition-shadow duration-300 hover:shadow-lift">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-10 rounded-[20px] opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
                    style={{ background: "radial-gradient(380px circle at var(--gx, 50%) var(--gy, 50%), color-mix(in srgb, var(--color-paper) 30%, transparent), transparent 60%)" }}
                  />
                  <div className={`relative aspect-[4/3.4] overflow-hidden rounded-[14px] ${item.tone}`}>
                    <div className="absolute inset-0 p-6 transition-transform duration-500 ease-out group-hover/card:scale-[1.04]">{item.art}</div>
                    <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-[linear-gradient(to_top,var(--color-ink),transparent)] opacity-60" />
                  </div>
                  <div className="flex flex-1 flex-col px-2 pb-3 pt-5">
                    <h3 className="font-condensed text-[2rem] font-bold leading-[0.95] tracking-[-0.005em]">{item.title}</h3>
                    <p className="mt-4 flex-1 text-sm leading-relaxed text-muted">{item.copy}</p>
                    <CtaLink href={item.href} variant="outline" className="relative z-20 mt-6 h-10 self-start px-5 text-[13px]">
                      {item.cta}
                    </CtaLink>
                  </div>
                </article>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- market universe ---------- */

// Positions (percent of the stage) for market tiles around the centre frame, and for the small lime squares.
const SPOTS: [number, number][] = [
  [17, 8], [44, 3], [68, 9], [86, 19], [6, 33], [29, 21], [78, 37], [94, 52], [11, 61], [26, 77], [72, 72], [88, 85], [41, 91], [59, 95],
];
const DOTS: [number, number][] = [
  [35, 12], [56, 15], [22, 45], [82, 58], [8, 84], [95, 32], [64, 82], [32, 96], [50, 5],
];
const OCTAGON = "[clip-path:polygon(18%_0,82%_0,100%_18%,100%_82%,82%_100%,18%_100%,0_82%,0_18%)]";

function Universe({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const tiles = markets.slice(0, SPOTS.length);
  const counts = CLASS_ORDER.map((c) => [c, markets.filter((m) => m.assetClass === c).length] as const).filter(([, n]) => n > 0);
  const centre = (
    <div className="relative mx-auto aspect-square w-full max-w-[400px]">
      <div aria-hidden className={`orb-hide absolute inset-0 bg-accent-fg ${OCTAGON}`} />
      <div aria-hidden className={`absolute inset-[3px] bg-ground ${OCTAGON}`} />
      <OrbSlot shape="ring" fallback="" className="absolute inset-0" />
      <div className="relative flex size-full flex-col items-center justify-center px-12 text-center">
        <p className="text-balance font-display text-lg font-medium leading-snug tracking-[-0.02em] sm:text-[1.3rem]">Trade {markets.length} markets from one margin account.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {counts.map(([c, n]) => (
            <Link key={c} href="#markets" className="inline-flex items-center justify-center rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted transition-colors hover:border-accent-fg hover:bg-accent hover:text-accent-ink">
              {CLASS_LABEL[c]}s · {n}
            </Link>
          ))}
        </div>
        <CtaLink href="/markets" variant="outline" className="mt-5 h-10 px-5 text-[13px]">
          Explore markets
        </CtaLink>
      </div>
    </div>
  );
  return (
    <section id="universe" aria-label="Markets on ZENOMARKETS" className="zeno-grid relative overflow-hidden py-10 sm:py-16">
      <div className={`${FRAME} relative hidden h-[760px] lg:block`} onPointerMove={pointerVars} onPointerLeave={resetPointerVars}>
        {DOTS.map(([x, y], i) => {
          const depth = -24 - (i % 3) * 16;
          return (
            <span
              key={`${x}-${y}`}
              aria-hidden
              className="absolute size-3.5 rounded-[3px] bg-accent transition-transform duration-700 ease-out"
              style={{ left: `${x}%`, top: `${y}%`, transform: `translate(calc((var(--px, 0.5) - 0.5) * ${depth}px), calc((var(--py, 0.5) - 0.5) * ${depth}px)) rotate(45deg)` }}
            />
          );
        })}
        {tiles.map((market, i) => {
          const [x, y] = SPOTS[i]!;
          // Shallow enough that a tile never slides out from under the pointer that is hovering it.
          const depth = 10 + (i % 4) * 6;
          const spark = sparks?.[market.symbol];
          return (
            <Link
              key={market.symbol}
              href={`/perpetuals?market=${market.symbol}`}
              aria-label={`Trade ${market.symbol}`}
              className="group absolute -translate-x-1/2 transition-transform duration-500 ease-out hover:z-10 focus-visible:z-10"
              style={{ left: `${x}%`, top: `${y}%`, transform: `translate(calc((var(--px, 0.5) - 0.5) * ${depth}px), calc((var(--py, 0.5) - 0.5) * ${depth}px))` }}
            >
              <span className="zeno-float flex flex-col items-center gap-2" style={{ animationDelay: `${(i % 5) * -1.2}s` }}>
                <span className="grid size-14 place-items-center rounded-2xl bg-raised shadow-card ring-1 ring-line transition-[transform,box-shadow] duration-200 group-hover:scale-110 group-hover:shadow-lift group-hover:ring-2 group-hover:ring-accent-fg">
                  <MarketLogo symbol={market.symbol} className="size-9!" />
                </span>
                <span className="text-xs font-medium">{market.symbol}</span>
              </span>
              {spark ? (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 font-mono text-[11px] text-paper opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                  {fmtUsd(spark.price)} <span className={spark.changePct >= 0 ? "text-lime" : "text-coral"}>{fmtPct(spark.changePct)}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
        <div className="absolute left-1/2 top-1/2 w-[400px] -translate-x-1/2 -translate-y-1/2">{centre}</div>
      </div>
      <div className={`${FRAME} lg:hidden`}>
        {centre}
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
    <svg aria-hidden viewBox="0 0 200 200" className="draw-art size-full" fill="none">
      <rect x="10" y="10" width="180" height="180" rx="22" pathLength={1} data-draw className="stroke-current" strokeWidth="2.5" />
      {dots.map(([x, y], i) => (
        <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width="8" height="8" rx="2" data-pop style={{ transitionDelay: `${600 + i * 25}ms` }} className="fill-current" />
      ))}
    </svg>
  );
}

function ArtFan() {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className="draw-art size-full" fill="none">
      <rect x="40" y="10" width="120" height="120" rx="18" pathLength={1} data-draw className="stroke-current" strokeWidth="2.5" />
      {[20, 55, 100, 145, 180].map((x, i) => (
        <g key={x}>
          <line x1="100" y1="60" x2={x} y2="180" pathLength={1} data-draw style={{ transitionDelay: `${500 + i * 120}ms` }} className="stroke-current" strokeWidth="2" />
          <rect x={x - 6} y="174" width="12" height="12" rx="3" data-pop style={{ transitionDelay: `${1200 + i * 120}ms` }} className="fill-current" />
        </g>
      ))}
      <rect x="93" y="53" width="14" height="14" rx="3" data-pop style={{ transitionDelay: "400ms" }} className="fill-current" />
    </svg>
  );
}

function ArtStack() {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className="draw-art size-full" fill="none">
      {[50, 100, 150].map((x, i) => (
        <line key={x} x1={x} x2={x} y1="0" y2="45" data-pop style={{ transitionDelay: `${1300 + i * 150}ms` }} className="stroke-current" strokeWidth="2.5" strokeDasharray="6 6" />
      ))}
      <path d="M100 55 L170 85 L100 115 L30 85 Z" pathLength={1} data-draw className="stroke-current" strokeWidth="2.5" />
      <path d="M30 85 V160 L100 190 L170 160 V85" pathLength={1} data-draw style={{ transitionDelay: "300ms" }} className="stroke-current" strokeWidth="2.5" />
      <path d="M30 122 L100 152 L170 122" pathLength={1} data-draw style={{ transitionDelay: "600ms" }} className="stroke-current" strokeWidth="2.5" />
      <line x1="100" x2="100" y1="115" y2="190" pathLength={1} data-draw style={{ transitionDelay: "800ms" }} className="stroke-current" strokeWidth="2.5" />
    </svg>
  );
}

function OnchainStandard({ markets }: { markets: CardMarket[] }) {
  const maxLev = Math.max(...markets.map((m) => m.maxLeverage), 1);
  const items = [
    { art: <ArtGrid />, value: markets.length, format: (n: number) => `${Math.round(n)}`, label: "Markets live", source: "/markets", copy: "Stocks, ETFs, crypto and commodities, each priced by an oracle and settled in USDG." },
    { art: <ArtFan />, value: maxLev, format: (n: number) => `${Math.round(n)}x`, label: "Max leverage", source: "/docs#parameters", copy: "One vault margins every position, so a single deposit reaches every market." },
    { art: <ArtStack />, value: LISTED_CONTRACTS.length, format: (n: number) => `${Math.round(n)}`, label: "Contracts on chain", source: "/docs#verify", copy: "Every contract sits behind an ERC-1967 proxy and is open on the explorer." },
  ];
  return (
    <section id="standard" className="relative bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead title="The onchain standard" orb={{ shape: "lattice", side: "right" }}>
          Prices from Chainlink behind a staleness and deviation guard, margin in one vault, settlement by contracts anyone can read. Check every number yourself.
        </SectionHead>
        <div className="mt-16 grid gap-14 md:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.label} delay={i * 120} className="group text-center">
              <div className="mx-auto size-44 text-accent-fg transition-transform duration-500 ease-out group-hover:-rotate-3 group-hover:scale-105 sm:size-52">{item.art}</div>
              <p className="mt-8 font-display text-xl font-medium tracking-[-0.02em]">
                <span className="inline-block rounded-[4px] bg-accent px-1.5 text-accent-ink transition-transform duration-300 group-hover:-rotate-2 group-hover:scale-110">
                  <CountUp value={item.value} format={item.format} duration={1200} />
                </span>{" "}
                {item.label}
              </p>
              <Link href={item.source} className="mt-4 inline-block text-xs text-muted underline underline-offset-4 hover:text-text">
                Source
              </Link>
              <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-muted">{item.copy}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-14 flex justify-center">
          <Magnetic>
            <CtaLink href="/markets">View live data</CtaLink>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}

/* ---------- hands-on products ---------- */

/// A calculator on a coloured frame, with a row of market chips above it: pick a market and the numbers re-price.
function TryCard({ tag, copy, href, cta, tone, chipOn, choices, render }: { tag: string; copy: string; href: string; cta: string; tone: string; chipOn: string; choices: CardMarket[]; render: (market: CardMarket, price: number) => ReactNode }) {
  const { data: sparks } = useSparks();
  const [symbol, setSymbol] = useState<string>();
  const active = choices.find((m) => m.symbol === symbol) ?? choices[0];
  const price = active ? sparks?.[active.symbol]?.price : undefined;
  return (
    <Reveal>
      <div onPointerMove={pointerVars} onPointerLeave={resetPointerVars} className={`group/try relative overflow-hidden rounded-[18px] p-4 sm:p-6 ${tone}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/try:opacity-100"
          style={{ background: "radial-gradient(380px circle at calc(var(--px, 0.5) * 100%) calc(var(--py, 0.5) * 100%), color-mix(in srgb, var(--color-paper) 30%, transparent), transparent 65%)" }}
        />
        <div role="radiogroup" aria-label={`${tag} market`} className="relative mb-4 flex flex-wrap gap-2">
          {choices.map((m) => {
            const on = active?.symbol === m.symbol;
            return (
              <button key={m.symbol} type="button" role="radio" aria-checked={on} onClick={() => setSymbol(m.symbol)} className={`h-8 rounded-full px-3.5 font-mono text-xs uppercase tracking-[0.1em] transition-[background-color,color,transform] duration-200 active:scale-95 ${on ? chipOn : "bg-raised/85 text-text hover:bg-raised"}`}>
                {m.symbol}
              </button>
            );
          })}
        </div>
        <div className="relative rounded-[14px] bg-raised p-4 shadow-lift sm:p-5">{active && price ? render(active, price) : <div className="h-[420px] animate-pulse rounded-panel bg-surface" />}</div>
      </div>
      <Eyebrow className="mt-6">{tag}</Eyebrow>
      <p className="mt-3 text-pretty text-lg leading-snug sm:text-xl">{copy}</p>
      <CtaLink href={href} variant="outline" className="mt-5 h-10 px-5 text-[13px]">
        {cta}
      </CtaLink>
    </Reveal>
  );
}

function HandsOn({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  return (
    <section id="try" className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead eyebrow="One margin account" title="Trade it, hedge it, see it first" orb={{ shape: "candles", side: "left" }}>
          Every product draws on the same USDG balance. Pick a market and try the numbers, priced live; nothing is signed.
        </SectionHead>
        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <TryCard
            tag="Perpetuals"
            copy="Set a side and a leverage and watch the outcome across prices. Oracle mark price, limit, stop and take-profit orders, cross or isolated margin."
            href="/perpetuals"
            cta="Learn about perps"
            tone="bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_45%,var(--color-surface)))]"
            chipOn="bg-ink text-paper"
            choices={pricedFirst(markets, sparks, ["BTC", "ETH", "NVDA", "SPY", "TSLA"])}
            render={(m, price) => <PerpWidget key={m.symbol} symbol={m.symbol} price={price} maxLeverage={m.maxLeverage} />}
          />
          <TryCard
            tag="Options"
            copy="Pick a strike and see the payoff at expiry. Weekly and monthly expiries, Greeks on every strike and a strategy builder, settled in USDG."
            href="/options"
            cta="Learn about options"
            tone="bg-[linear-gradient(135deg,var(--color-ink),color-mix(in_srgb,var(--color-lime)_35%,var(--color-ink)))]"
            chipOn="bg-accent text-accent-ink"
            choices={pricedFirst(markets, sparks, ["NVDA", "TSLA", "AAPL", "SPY", "QQQ"])}
            render={(m, price) => <OptionsWidget key={m.symbol} symbol={m.symbol} price={price} />}
          />
        </div>
      </div>
    </section>
  );
}

/* ---------- markets explorer ---------- */

/// One market as a card. The sparkline answers the pointer: a crosshair, and the price that hour in the footer.
function MarketCard({ market, spark, index }: { market: CardMarket; spark: Spark; index: number }) {
  const [at, setAt] = useState<number | null>(null);
  const closes = spark.closes;
  const last = closes.length - 1;
  const i = at ?? last;
  const min = Math.min(...closes);
  const span = Math.max(...closes) - min || 1;
  const up = spark.changePct >= 0;
  const x = (i / last) * 100;
  const y = ((28 - ((closes[i]! - min) / span) * 26) / 30) * 100;
  return (
    <Link
      href={`/perpetuals?market=${market.symbol}`}
      className="card-in group flex h-full flex-col rounded-[16px] bg-surface p-5 transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-raised hover:shadow-card"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className="flex items-start justify-between">
        <MarketLogo symbol={market.symbol} className="size-10! rounded-[10px]! transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110" />
        <span className="inline-flex items-center gap-2 text-xs text-muted transition-colors group-hover:text-text">
          Trade
          <span className="group/cta grid size-6 place-items-center rounded-[6px] border border-line transition-colors group-hover:border-accent-fg group-hover:bg-accent group-hover:text-accent-ink">
            <Arrow />
          </span>
        </span>
      </div>
      <p className="mt-6 text-lg font-medium">{market.symbol}</p>
      <p className="truncate text-sm text-muted">{market.name}</p>
      <div
        className="relative mt-4 h-12"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt(Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * last));
        }}
        onPointerLeave={() => setAt(null)}
      >
        <Sparkline closes={closes} up={up} className="size-full" />
        {at !== null ? (
          <>
            <span aria-hidden className="absolute inset-y-0 w-px bg-text/25" style={{ left: `${x}%` }} />
            <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised bg-accent-fg" style={{ left: `${x}%`, top: `${y}%` }} />
          </>
        ) : null}
      </div>
      <p className="mt-3 flex items-baseline justify-between font-mono text-sm tabular-nums">
        {fmtUsd(at === null ? spark.price : closes[i]!)}
        <span className={at === null ? (up ? "text-up" : "text-down") : "text-muted"}>{at === null ? fmtPct(spark.changePct) : `${last - i}h ago`}</span>
      </p>
    </Link>
  );
}

function MarketsExplorer({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const present = CLASS_ORDER.filter((c) => markets.some((m) => m.assetClass === c));
  const [tab, setTab] = useState<AssetClass>("stock");
  const rows = markets.filter((m) => m.assetClass === tab && sparks?.[m.symbol]).slice(0, 8);
  return (
    <section id="markets" className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead title="Wall Street, the chain and the commodity pit" orb={{ shape: "wave", side: "right" }}>
          Every market settles in USDG against one vault. Switch from Nvidia to Bitcoin to gold without moving funds, bridging or opening another app.
        </SectionHead>
        <div
          className="mt-8 flex flex-wrap justify-center gap-3"
          role="tablist"
          aria-label="Asset classes"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const next = present[(present.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + present.length) % present.length]!;
            setTab(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
          }}
        >
          {present.map((c) => (
            <button
              key={c}
              role="tab"
              type="button"
              data-tab={c}
              tabIndex={tab === c ? 0 : -1}
              aria-selected={tab === c}
              onClick={() => setTab(c)}
              className={`h-10 min-w-[7.5rem] rounded-full px-5 text-sm transition-[background-color,color,box-shadow,border-color,transform] duration-200 active:scale-95 ${tab === c ? "bg-accent text-accent-ink shadow-accent-glow" : "border border-line bg-raised text-muted hover:border-text hover:text-text"}`}
            >
              {CLASS_LABEL[c]}s <span className="ml-1 opacity-60">{markets.filter((m) => m.assetClass === c).length}</span>
            </button>
          ))}
        </div>
        <div key={tab} className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.length === 0
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className="h-56 animate-pulse rounded-[16px] bg-surface" />)
            : rows.map((row, i) => <MarketCard key={row.symbol} market={row} spark={sparks![row.symbol]!} index={i} />)}
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

/* ---------- roadmap ---------- */

const ROADMAP = [
  { tag: "Testnet", title: "Every feature, live", items: ["Perps, options, RFQ", "Lending & borrowing", "Copy trading, leaderboard, PnL cards", "21 markets across four asset classes"], now: true },
  { tag: "V1.0", title: "Mainnet: the trading core", items: ["Perpetuals and options on mainnet", "Stocks, ETFs, crypto, commodities", "Portfolio, leaderboard, PnL cards"] },
  { tag: "V2.0", title: "Capital", items: ["Stock-backed USDG loans", "Subaccounts", "Copy trading", "RFQ block trades"] },
  { tag: "V3.0", title: "ZENO", items: ["ZENO token", "Fee-funded buyback", "Holder alignment with venue revenue"] },
];

/// The roadmap cards scroll sideways when they do not fit: drag them with a mouse, use the arrows, and a bar shows
/// how far along you are. When they fit, the controls step aside.
function Roadmap() {
  const reduced = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const room = el.scrollWidth - el.clientWidth;
      setOverflow(room > 4);
      setProgress(room > 0 ? el.scrollLeft / room : 0);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);
  const step = (dir: number) => list.current?.scrollBy({ left: dir * 320, behavior: reduced ? "auto" : "smooth" });
  return (
    <section id="roadmap" className="relative bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <SectionHead eyebrow="Roadmap" title="Shipped in versions, each one on chain" orb={{ shape: "stairs", side: "left" }}>
          The testnet runs every feature today. Mainnet opens in stages, so each release can be checked before the next.
        </SectionHead>
      </div>
      <ol
        ref={list}
        className="mt-14 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 [scrollbar-width:none] sm:px-8 [&>li:first-child]:ml-auto [&>li:last-child]:mr-auto [&.dragging]:cursor-grabbing [&.dragging]:snap-none"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || !overflow || !list.current) return;
          drag.current = { x: event.clientX, left: list.current.scrollLeft, moved: 0 };
          list.current.classList.add("dragging");
        }}
        onPointerMove={(event) => {
          if (!drag.current || !list.current) return;
          const dx = event.clientX - drag.current.x;
          drag.current.moved = Math.max(drag.current.moved, Math.abs(dx));
          list.current.scrollLeft = drag.current.left - dx;
        }}
        onPointerUp={() => {
          drag.current = null;
          list.current?.classList.remove("dragging");
        }}
        onPointerLeave={() => {
          drag.current = null;
          list.current?.classList.remove("dragging");
        }}
      >
        {ROADMAP.map((step, i) => (
          <li key={step.tag} className={`group w-[280px] shrink-0 snap-start select-none overflow-hidden rounded-[16px] bg-raised shadow-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-lift sm:w-[300px] ${overflow ? "cursor-grab" : ""}`}>
            <div className={`theme-dark relative h-36 overflow-hidden ${step.now ? "bg-[linear-gradient(135deg,var(--color-ink)_30%,color-mix(in_srgb,var(--color-lime)_70%,var(--color-ink)))]" : "bg-ink"}`}>
              <div aria-hidden className="zeno-grid-dark absolute inset-0 transition-transform duration-700 group-hover:scale-125" />
              <div className="relative flex h-full flex-col justify-between p-5">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-ink">{step.now ? "Live now" : `Step 0${i}`}</span>
                  <span className="font-mono text-[11px] text-muted">ZENOMARKETS</span>
                </div>
                <span className="origin-left font-condensed text-5xl font-extrabold uppercase italic text-paper transition-[transform,color] duration-300 group-hover:scale-110 group-hover:text-lime">{step.tag}</span>
              </div>
            </div>
            <div className="p-5">
              <p className="font-display text-lg font-medium tracking-[-0.02em]">{step.title}</p>
              <ul className="mt-3 space-y-2">
                {step.items.map((item, k) => (
                  <li key={item} className="flex gap-2.5 text-sm text-muted transition-colors duration-300 group-hover:text-text" style={{ transitionDelay: `${k * 50}ms` }}>
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-[1px] bg-accent-fg transition-transform duration-300 group-hover:rotate-45 group-hover:scale-125" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {overflow ? (
        <div className={`${FRAME} mt-6 flex items-center gap-4`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent-fg transition-[width] duration-150" style={{ width: `${Math.max(12, progress * 100)}%` }} />
          </div>
          {[-1, 1].map((dir) => (
            <button
              key={dir}
              type="button"
              aria-label={dir < 0 ? "Previous release" : "Next release"}
              disabled={dir < 0 ? progress <= 0.01 : progress >= 0.99}
              onClick={() => step(dir)}
              className="grid size-10 place-items-center rounded-full border border-line bg-raised transition-colors hover:border-text disabled:opacity-40"
            >
              <svg aria-hidden viewBox="0 0 14 10" className={`h-2.5 w-3.5 ${dir < 0 ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M0 5h12M8 1l4 4-4 4" />
              </svg>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ---------- ready ---------- */

function Ready() {
  return (
    <section className="zeno-grid relative pb-16 pt-4 text-center sm:pb-20">
      <h2 className="font-display text-[1.9rem] font-medium tracking-[-0.03em] sm:text-[2.4rem]">Ready to trade on ZENOMARKETS?</h2>
      <div className="mt-6 flex justify-center">
        <Magnetic strength={0.35}>
          <CtaLink href="/markets">Launch app</CtaLink>
        </Magnetic>
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

/// The six modules as blocks. Until the visitor touches them they light up one by one; hovering one lights its
/// contracts in the list, pressing one opens the list filtered to that module.
function Contracts() {
  const reduced = useReducedMotion();
  const section = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [touched, setTouched] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { root: document.getElementById("main"), threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (touched || reduced || !inView) return;
    const id = setInterval(() => setFocus((f) => MODULES[(MODULES.findIndex((m) => m.name === f) + 1) % MODULES.length]!.name), 2000);
    return () => clearInterval(id);
  }, [touched, reduced, inView]);
  const shown = pinned ?? focus;
  const highlighted = useMemo(() => new Set(MODULES.find((m) => m.name === shown)?.match ?? []), [shown]);
  const rows = pinned ? LISTED_CONTRACTS.filter((row) => highlighted.has(row.contract)) : LISTED_CONTRACTS;
  return (
    <section ref={section} id="contracts" className="zeno-grid relative pb-20 sm:pb-28">
      <div className="px-3 sm:px-6">
        <div className="mx-auto grid max-w-[1400px] items-center gap-10 overflow-hidden rounded-[22px] bg-[linear-gradient(180deg,var(--color-accent)_0%,color-mix(in_srgb,var(--color-accent)_35%,var(--color-surface))_100%)] px-6 py-12 text-accent-ink sm:px-12 sm:py-16 lg:grid-cols-2 lg:px-16">
          <div>
            <div
              className="iso-stage mx-auto"
              onMouseLeave={() => {
                if (touched) setFocus(null);
              }}
            >
              {MODULES.map((module, i) => (
                <button
                  key={module.name}
                  type="button"
                  onMouseEnter={() => {
                    setTouched(true);
                    setFocus(module.name);
                  }}
                  onFocus={() => {
                    setTouched(true);
                    setFocus(module.name);
                  }}
                  onClick={() => {
                    setTouched(true);
                    setPinned((p) => (p === module.name ? null : module.name));
                    setOpen(true);
                  }}
                  className={`iso-cube ${shown === module.name ? "is-on" : ""}`}
                  style={{ "--c": i % 3, "--r": Math.floor(i / 3) } as CSSProperties}
                  aria-pressed={pinned === module.name}
                  aria-label={`${module.name}: ${module.detail}. Show its contracts`}
                >
                  <span className="iso-top" />
                  <span className="iso-left" />
                  <span className="iso-right" />
                  <span className="iso-label">{module.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 h-5 text-center font-mono text-xs">{shown ? MODULES.find((m) => m.name === shown)?.detail : "Six modules · one vault · one oracle path"}</p>
            <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-[0.14em] opacity-60">Press a block to list its contracts</p>
          </div>
          <div>
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="font-mono text-[12px] uppercase tracking-[0.1em]">Verified on chain</p>
                <h2 className="mt-3 font-display text-[2.1rem] font-medium leading-[1.1] tracking-[-0.03em] sm:text-[2.6rem]">{LISTED_CONTRACTS.length} contracts. Every one on the explorer.</h2>
              </div>
              <OrbSlot shape="modules" className="size-20 shrink-0 sm:size-28 lg:size-32" />
            </div>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed">Six modules, each behind an ERC-1967 proxy. Hover a block to light up its contracts; open any address on Blockscout.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Magnetic>
                <CtaLink href="/docs#verify" className="h-10 px-5 text-[13px]">
                  Verify it yourself
                </CtaLink>
              </Magnetic>
            </div>
            <details className="group mt-6 overflow-hidden rounded-[14px] bg-raised text-text shadow-card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                <span>{pinned ? `${pinned} module · ${rows.length} contracts` : `All contracts · ${networkName(env.chainId)}`}</span>
                <span aria-hidden className="transition-transform group-open:rotate-45">+</span>
              </summary>
              {pinned ? (
                <div className="flex items-center justify-between border-t border-line bg-accent-soft px-5 py-2 text-xs">
                  <span>{MODULES.find((m) => m.name === pinned)?.detail}</span>
                  <button type="button" onClick={() => setPinned(null)} className="rounded-full px-2 py-0.5 font-medium underline underline-offset-2 hover:bg-raised">
                    Show all
                  </button>
                </div>
              ) : null}
              <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
                {rows.length === 0 ? <li className="px-5 py-4 text-sm text-muted">No {pinned} contracts on this network yet.</li> : null}
                {rows.map((row) => {
                  const url = explorerAddressUrl(env.explorerUrl, row.address);
                  const lit = !pinned && highlighted.has(row.contract);
                  return (
                    <li key={row.address} className={`flex items-center justify-between gap-3 px-5 py-2.5 transition-colors duration-200 ${lit ? "bg-accent-soft" : "hover:bg-surface"}`}>
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
    { href: "/markets", label: "Launch app", look: "bg-accent text-accent-ink shadow-accent-glow before:bg-ink hover:text-paper" },
    { href: "/docs", label: "Read the docs", look: "bg-raised before:bg-ink hover:text-paper" },
    { href: X_URL, label: "Follow @UseZenoMarkets", look: "bg-raised before:bg-accent hover:text-accent-ink" },
  ];
  return (
    <section id="start" className="relative overflow-hidden bg-surface py-20 sm:py-24">
      <div className={`${FRAME} grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <div className="relative flex justify-center">
          <div aria-hidden className="absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/40 blur-[90px]" />
          <OrbSlot shape="logo" fallback="/zeno-glass.png" className="zeno-float relative size-56 sm:size-72" />
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
                className={`group/cta relative flex h-20 items-center justify-between overflow-hidden rounded-[22px] px-6 font-display text-2xl font-medium tracking-[-0.02em] transition-[color,transform] duration-300 before:absolute before:inset-0 before:origin-left before:scale-x-0 before:transition-transform before:duration-500 before:ease-out hover:-translate-y-0.5 hover:before:scale-x-100 sm:h-24 sm:text-3xl ${action.look}`}
              >
                <span className="relative">{action.label}</span>
                <span className="relative">
                  <Arrow />
                </span>
              </Link>
            );
          })}
          {lend && sparks ? (
            <details className="group rounded-[22px] bg-raised">
              <summary className="flex h-20 cursor-pointer list-none items-center justify-between px-6 font-display text-2xl font-medium tracking-[-0.02em] sm:h-24 sm:text-3xl">
                Try a stock-backed loan
                <span aria-hidden className="text-muted transition-transform duration-300 group-open:rotate-45">+</span>
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
      <Universe markets={markets} />
      <OnchainStandard markets={markets} />
      <HandsOn markets={markets} />
      <MarketsExplorer markets={markets} />
      <Roadmap />
      <Ready />
      <Contracts />
      <Closing markets={markets} />
      <Footer />
      <SectionRail sections={RAIL} />
      <LogoOrb />
    </>
  );
}
