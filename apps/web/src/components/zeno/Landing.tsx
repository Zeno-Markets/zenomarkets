"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContractCopyButton } from "@/components/ContractCopyButton";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { LISTED_CONTRACTS } from "@/lib/contracts";
import { networkName } from "@/lib/network";
import { Footer } from "@/components/Footer";
import { X_URL } from "@/lib/social";
import { CLASS_LABEL, CLASS_ORDER, useCardMarkets, useSparks, type AssetClass, type CardMarket } from "./data";
import { fmtPct, fmtUsd, HeroCarousel } from "./HeroCarousel";
import { LendingWidget, OptionsWidget, PerpWidget } from "./widgets";

/* ---------- small pieces ---------- */

/// Three lime squares in a stair, the page's signature accent (it rhymes with the pixel face).
export function PixelMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-grid grid-cols-3 gap-[3px] ${className}`}>
      {[1, 0, 1, 0, 1, 0, 0, 0, 0].map((on, i) => (
        <span key={i} className={`size-[6px] ${on ? "bg-accent" : "bg-transparent"}`} />
      ))}
    </span>
  );
}

function Eyebrow({ index, children, dark }: { index: string; children: ReactNode; dark?: boolean }) {
  return (
    <p className={`flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em] ${dark ? "text-[#a4a995]" : "text-muted"}`}>
      <PixelMark />
      <span className={dark ? "text-[#d2f53a]" : "text-accent-fg"}>{index}</span>
      <span>{children}</span>
    </p>
  );
}

export function CtaLink({ href, children, variant = "solid", className = "" }: { href: string; children: ReactNode; variant?: "solid" | "ghost" | "dark" | "light"; className?: string }) {
  const base =
    "group/cta relative inline-flex h-12 items-center gap-3 overflow-hidden px-6 font-mono text-[13px] font-medium uppercase tracking-[0.14em] transition-[transform,box-shadow,background-color,color] duration-200 ease-out active:translate-y-px active:scale-[0.98]";
  const look =
    variant === "solid"
      ? "bg-accent text-accent-ink shadow-[0_0_0_0_var(--color-accent)] hover:shadow-accent-glow"
      : variant === "dark"
        ? "bg-ink text-[#eef2e2] hover:bg-[#1c2210]"
        : variant === "light"
          ? "border border-[#eef2e2]/30 text-[#eef2e2] hover:border-[#eef2e2] hover:bg-[#eef2e2] hover:text-ink"
        : "border border-text/20 text-text hover:border-text hover:bg-text hover:text-ground";
  return (
    <Link href={href} className={`${base} ${look} ${className}`}>
      <span className="relative z-10">{children}</span>
      <span aria-hidden className="relative z-10 grid size-4 grid-cols-2 gap-[2px] transition-transform duration-300 group-hover/cta:translate-x-1">
        <span className="bg-current" />
        <span />
        <span />
        <span className="bg-current" />
      </span>
    </Link>
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

/// Words that fill from faint to full ink as the block scrolls through the viewport.
function WordFill({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const el = ref.current;
    const scroller = document.getElementById("main");
    if (!el || !scroller) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const view = window.innerHeight;
        setProgress(Math.min(1, Math.max(0, (view * 0.85 - rect.top) / (rect.height + view * 0.35))));
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
    };
  }, []);
  const words = text.split(" ");
  return (
    <p ref={ref} className={className}>
      {words.map((word, i) => (
        <span key={i} className="transition-colors duration-300" style={{ color: i / words.length < progress ? "#eef2e2" : "rgba(238,242,226,0.18)" }}>
          {word}{" "}
        </span>
      ))}
    </p>
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

const FRAME = "mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12";

/* ---------- hero ---------- */

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
    <section className="zeno-grid relative overflow-hidden pt-[112px]">
      <div className={`${FRAME} relative text-center`}>
        <Reveal>
          <p className="inline-flex items-center gap-3 rounded-full border border-line bg-raised/70 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-accent-fg" />
            </span>
            Live on Robinhood Chain
          </p>
        </Reveal>
        <h1 className="mx-auto mt-6 max-w-5xl text-balance font-display text-[clamp(2.5rem,6.6vw,5.9rem)] font-semibold leading-[0.98] tracking-[-0.055em]">
          <span className="block text-muted">One view.</span>
          <span className="mt-1 block font-pixel text-[0.86em] font-medium tracking-[-0.02em]">A world of markets.</span>
        </h1>
      </div>
      <div className="relative -mt-4 sm:-mt-6">
        <HeroCarousel markets={markets} sparks={sparks} />
      </div>
      <div className={`${FRAME} relative pb-14 text-center`}>
        <p className="mx-auto max-w-2xl text-balance text-[17px] leading-relaxed text-muted sm:text-lg">
          Stocks, ETFs, crypto and commodities. Perps, options, lending and borrowing on Robinhood Chain, from one margin account.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <CtaLink href="/markets">Launch app</CtaLink>
          <CtaLink href="#products" variant="ghost">
            Explore products
          </CtaLink>
        </div>
        <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 border-y border-line sm:grid-cols-4">
          {stats.map((stat, i) => (
            <div key={stat.label} className={`px-4 py-5 ${i ? "sm:border-l sm:border-line" : ""} ${i % 2 ? "border-l border-line sm:border-l" : ""} ${i > 1 ? "border-t border-line sm:border-t-0" : ""}`}>
              <dt className="order-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{stat.label}</dt>
              <dd className="font-display text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ---------- markets explorer ---------- */

function MarketsExplorer({ markets }: { markets: CardMarket[] }) {
  const { data: sparks } = useSparks();
  const [tab, setTab] = useState<AssetClass>("stock");
  const rows = markets.filter((m) => m.assetClass === tab && sparks?.[m.symbol]);
  const [picked, setPicked] = useState<string>();
  const active = rows.find((r) => r.symbol === picked) ?? rows[0];
  const spark = active ? sparks?.[active.symbol] : undefined;
  const present = CLASS_ORDER.filter((c) => markets.some((m) => m.assetClass === c));
  return (
    <section id="markets" className="relative border-t border-line bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <Eyebrow index="01">Markets</Eyebrow>
            <h2 className="mt-5 text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
              Wall Street, the chain and the commodity pit. <span className="text-muted">Same screen.</span>
            </h2>
            <p className="mt-5 max-w-md text-muted">
              Every market settles in USDG against one vault. Switch from Nvidia to Bitcoin to gold without moving funds, bridging or opening another app.
            </p>
            <div className="mt-8 flex flex-wrap gap-2" role="tablist">
              {present.map((c) => (
                <button
                  key={c}
                  role="tab"
                  type="button"
                  aria-selected={tab === c}
                  onClick={() => {
                    setTab(c);
                    setPicked(undefined);
                  }}
                  className={`h-10 px-4 font-mono text-xs uppercase tracking-[0.16em] transition-all duration-200 ${tab === c ? "bg-ink text-[#eef2e2] shadow-[inset_0_-3px_0_var(--color-accent)]" : "border border-line bg-raised text-muted hover:border-text/40 hover:text-text"}`}
                >
                  {CLASS_LABEL[c]}s <span className="ml-1 opacity-60">{markets.filter((m) => m.assetClass === c).length}</span>
                </button>
              ))}
            </div>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {rows.slice(0, 7).map((row) => {
                const s = sparks![row.symbol]!;
                const up = s.changePct >= 0;
                return (
                  <li key={row.symbol}>
                    <button
                      type="button"
                      onClick={() => setPicked(row.symbol)}
                      onMouseEnter={() => setPicked(row.symbol)}
                      className={`grid w-full grid-cols-[64px_1fr_72px_auto] items-center gap-3 px-2 py-3 text-left transition-colors duration-150 ${active?.symbol === row.symbol ? "bg-accent-soft" : "hover:bg-raised"}`}
                    >
                      <span className="font-mono text-sm font-semibold">{row.symbol}</span>
                      <span className="truncate text-sm text-muted">{row.name}</span>
                      <Sparkline closes={s.closes} up={up} className="h-7 w-full" />
                      <span className="text-right font-mono text-sm tabular-nums">
                        {fmtUsd(s.price)} <span className={up ? "text-up" : "text-down"}>{fmtPct(s.changePct)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="lg:pt-14">
            {active && spark ? <DetailChart market={active} closes={spark.closes} price={spark.price} change={spark.changePct} /> : <div className="h-[420px] animate-pulse rounded-feature bg-raised" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailChart({ market, closes, price, change }: { market: CardMarket; closes: number[]; price: number; change: number }) {
  const W = 720;
  const H = 300;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = (max - min) * 0.1 || max * 0.01;
  const x = (i: number) => (i / (closes.length - 1)) * W;
  const y = (v: number) => H - ((v - (min - pad)) / (max + pad - (min - pad))) * H;
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const [hover, setHover] = useState<number | null>(null);
  const at = hover ?? closes.length - 1;
  const up = change >= 0;
  const hoursBack = closes.length - 1 - at;
  return (
    <div className="relative overflow-hidden rounded-feature bg-ink p-5 text-[#eef2e2] shadow-lift sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[#d2f53a]/20 blur-3xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-pixel text-sm uppercase tracking-[0.12em] text-[#d2f53a]">{CLASS_LABEL[market.assetClass]} · up to {market.maxLeverage}x</p>
          <p className="mt-1 font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{market.symbol}</p>
          <p className="text-sm text-[#a4a995]">{market.name}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-semibold tracking-[-0.03em] tabular-nums">{fmtUsd(hover === null ? price : closes[at]!)}</p>
          <p className={`font-mono text-sm ${up ? "text-[#d2f53a]" : "text-[#ff8a80]"}`}>{hover === null ? `${fmtPct(change)} today` : `${hoursBack}h ago`}</p>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="relative mt-6 h-[260px] w-full touch-none"
        preserveAspectRatio="none"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(Math.round(((event.clientX - rect.left) / rect.width) * (closes.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${market.symbol} price over five days`}
      >
        <defs>
          <linearGradient id="zeno-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? "#d2f53a" : "#ff6b5e"} stopOpacity="0.35" />
            <stop offset="1" stopColor={up ? "#d2f53a" : "#ff6b5e"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(238,242,226,0.07)" />
        ))}
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#zeno-area)" />
        <path d={line} fill="none" stroke={up ? "#d2f53a" : "#ff6b5e"} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        <line x1={x(at)} x2={x(at)} y1="0" y2={H} stroke="rgba(238,242,226,0.35)" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
        <circle cx={x(at)} cy={y(closes[at]!)} r="5" fill="#d2f53a" stroke="#0a0c05" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#eef2e2]/10 pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a4a995]">5 days · hourly · oracle-priced on chain</p>
        <div className="flex gap-2">
          <CtaLink href={`/perpetuals?market=${market.symbol}`} className="h-10 px-4 text-[11px]">
            Trade perp
          </CtaLink>
          <CtaLink href={`/options?market=${market.symbol}`} variant="light" className="h-10 px-4 text-[11px]">
            Options
          </CtaLink>
        </div>
      </div>
    </div>
  );
}

/* ---------- products ---------- */

function Products({ markets }: { markets: CardMarket[] }) {
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
  const lend = pick(["TSLA", "NVDA"]);
  const items: { id: string; tag: string; title: ReactNode; copy: string; points: string[]; href: string; widget: ReactNode }[] = [
    {
      id: "perps",
      tag: "Perpetuals",
      title: (
        <>
          Long or short <span className="font-pixel">anything</span> with a price.
        </>
      ),
      copy: "Up to 10x on index ETFs, 5x on blue chips and crypto. Market, limit, stop-loss and take-profit orders, isolated or cross margin, and funding that keeps the perp on its index.",
      points: ["Oracle mark price", "Limit, stop and take-profit orders", "Cross and isolated margin", "RFQ block trades"],
      href: "/perpetuals",
      widget: perp ? <PerpWidget symbol={perp.market.symbol} price={perp.price} maxLeverage={perp.market.maxLeverage} /> : null,
    },
    {
      id: "options",
      tag: "Options",
      title: (
        <>
          Define the risk. <span className="font-pixel">Keep the upside.</span>
        </>
      ),
      copy: "Cash-settled calls and puts on the same markets, with a live chain, Greeks and a strategy builder for spreads and straddles. The premium is your max loss.",
      points: ["Weekly and monthly expiries", "Greeks on every strike", "Strategy builder", "Settled in USDG"],
      href: "/options",
      widget: option ? <OptionsWidget symbol={option.market.symbol} price={option.price} /> : null,
    },
    {
      id: "lending",
      tag: "Lending & borrowing",
      title: (
        <>
          Borrow against your stocks. <span className="font-pixel">Don&apos;t sell them.</span>
        </>
      ),
      copy: "Lock tokenized shares as collateral and draw USDG at a fixed loan-to-value limit, or supply USDG to the vault and earn what borrowers pay.",
      points: ["Stock-backed USDG loans", "ERC-4626 lending vault", "Oracle with staleness and jump checks", "Repay any time"],
      href: "/lending",
      widget: lend ? <LendingWidget symbol={lend.market.symbol} price={lend.price} /> : null,
    },
  ];
  return (
    <section id="products" className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <Eyebrow index="02">Products</Eyebrow>
        <h2 className="mt-5 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
          Three ways to move. <span className="text-muted">One margin account.</span>
        </h2>
        <div className="mt-14 space-y-8">
          {items.map((item, i) => (
            <Reveal key={item.id}>
              <article id={item.id} className="grid overflow-hidden rounded-feature border border-line bg-raised shadow-[0_1px_0_var(--color-line)] lg:grid-cols-2">
                <div className={`relative flex flex-col justify-between p-7 sm:p-10 ${i % 2 ? "lg:order-2" : ""}`}>
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent-fg">
                      0{i + 1} / {item.tag}
                    </p>
                    <h3 className="mt-4 text-balance font-display text-3xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[2.6rem]">{item.title}</h3>
                    <p className="mt-4 max-w-lg text-muted">{item.copy}</p>
                    <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                      {item.points.map((point) => (
                        <li key={point} className="flex items-center gap-2.5 text-sm">
                          <span aria-hidden className="size-1.5 bg-accent-fg" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-8">
                    <CtaLink href={item.href} variant="dark">
                      Open {item.tag.split(" ")[0]}
                    </CtaLink>
                  </div>
                </div>
                <div className={`border-t border-line bg-ground/60 p-5 sm:p-8 lg:border-t-0 ${i % 2 ? "lg:border-r" : "lg:border-l"}`}>
                  {item.widget ?? <div className="h-[420px] animate-pulse rounded-panel bg-surface" />}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- statement ---------- */

function Statement() {
  return (
    <section className="relative overflow-hidden bg-ink py-24 text-[#eef2e2] sm:py-36">
      <div aria-hidden className="zeno-grid-dark absolute inset-0" />
      <div className={`${FRAME} relative`}>
        <Eyebrow index="03" dark>
          The idea
        </Eyebrow>
        <WordFill
          className="mt-8 max-w-5xl font-display text-[clamp(1.9rem,4.4vw,4rem)] font-semibold leading-[1.08] tracking-[-0.045em]"
          text="Your portfolio already spans Nasdaq, Bitcoin and gold. ZENOMARKETS puts all of it on one chain, priced by oracles, margined in one vault and settled by contracts anyone can read."
        />
        <div className="mt-14 grid gap-px overflow-hidden rounded-feature bg-[#eef2e2]/10 sm:grid-cols-3">
          {[
            ["Settlement", "USDG, a regulated dollar stablecoin, in one vault"],
            ["Prices", "Chainlink feeds behind a staleness and deviation guard"],
            ["Upgrades", "UUPS proxies: fixes ship without moving your funds"],
          ].map(([k, v]) => (
            <div key={k} className="bg-ink p-6 transition-colors duration-300 hover:bg-[#141808]">
              <p className="font-pixel text-sm uppercase tracking-[0.14em] text-[#d2f53a]">{k}</p>
              <p className="mt-2 text-[15px] text-[#a4a995]">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- architecture + contracts ---------- */

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
    <section id="contracts" className="relative border-t border-line bg-surface py-20 sm:py-28">
      <div className={FRAME}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="lg:sticky lg:top-8 lg:self-start">
            <Eyebrow index="04">Contracts</Eyebrow>
            <h2 className="mt-5 text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
              {rows.length} contracts. <span className="text-muted">Every one on the explorer.</span>
            </h2>
            <p className="mt-5 max-w-md text-muted">Six modules, each behind an ERC-1967 proxy. Hover a block to light up its contracts; open any address on Blockscout.</p>
            <div className="iso-stage mt-10" onMouseLeave={() => setFocus(null)}>
              {MODULES.map((module, i) => (
                <button
                  key={module.name}
                  type="button"
                  onMouseEnter={() => setFocus(module.name)}
                  onFocus={() => setFocus(module.name)}
                  onClick={() => setFocus(focus === module.name ? null : module.name)}
                  className={`iso-cube ${focus === module.name ? "is-on" : ""}`}
                  style={{ "--c": i % 3, "--r": Math.floor(i / 3) } as React.CSSProperties}
                  aria-label={`${module.name}: ${module.detail}`}
                >
                  <span className="iso-top" />
                  <span className="iso-left" />
                  <span className="iso-right" />
                  <span className="iso-label">{module.name}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 h-5 font-mono text-xs text-muted">{focus ? MODULES.find((m) => m.name === focus)?.detail : "Six modules · one vault · one oracle path"}</p>
          </div>
          <div className="overflow-hidden rounded-feature border border-line bg-raised">
            <div className="flex items-center justify-between border-b border-line px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              <span>Contract</span>
              <span>{networkName(env.chainId)}</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const url = explorerAddressUrl(env.explorerUrl, row.address);
                const lit = highlighted.has(row.contract);
                return (
                  <li key={row.address} className={`group grid grid-cols-1 items-center gap-1.5 px-5 py-3 sm:grid-cols-[1fr_auto] sm:gap-3 transition-colors duration-200 ${lit ? "bg-accent-soft" : "hover:bg-surface"}`}>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-mono text-[13px] font-medium">
                        <span className={`size-1.5 shrink-0 transition-colors ${lit ? "bg-accent-fg" : "bg-line group-hover:bg-accent-fg"}`} />
                        {row.contract}
                      </p>
                      <p className="mt-0.5 truncate pl-3.5 text-xs text-muted">{row.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="rounded-control px-2 py-1 font-mono text-xs text-muted transition-colors hover:bg-ink hover:text-[#eef2e2]">
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
          </div>
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
    <section id="roadmap" className="zeno-grid relative py-20 sm:py-28">
      <div className={FRAME}>
        <Eyebrow index="05">Roadmap</Eyebrow>
        <h2 className="mt-5 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
          Shipped in versions. <span className="text-muted">Each one on chain.</span>
        </h2>
        <ol className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ROADMAP.map((step, i) => (
            <Reveal key={step.tag} delay={i * 90}>
              <li className={`group relative h-full overflow-hidden rounded-feature border p-6 transition-transform duration-300 hover:-translate-y-1 ${step.now ? "border-transparent bg-ink text-[#eef2e2]" : "border-line bg-raised"}`}>
                {step.now ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(210,245,58,0.35),transparent_60%)]" /> : null}
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <span className={`font-pixel text-2xl font-bold ${step.now ? "text-[#d2f53a]" : ""}`}>{step.tag}</span>
                    {step.now ? <span className="rounded-full bg-[#d2f53a] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink">Now</span> : <span className="font-mono text-[11px] text-muted">0{i}</span>}
                  </div>
                  <p className="mt-6 font-display text-xl font-semibold tracking-[-0.03em]">{step.title}</p>
                  <ul className="mt-4 space-y-2">
                    {step.items.map((item) => (
                      <li key={item} className={`flex gap-2.5 text-sm ${step.now ? "text-[#c9cdb9]" : "text-muted"}`}>
                        <span aria-hidden className={`mt-[7px] size-1.5 shrink-0 ${step.now ? "bg-[#d2f53a]" : "bg-accent-fg"}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- closing ---------- */

function Closing() {
  return (
    <section className="relative overflow-hidden bg-ink text-[#eef2e2]">
      <div aria-hidden className="zeno-grid-dark absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d2f53a]/15 blur-[120px]" />
      <div className={`${FRAME} relative flex flex-col items-center py-24 text-center sm:py-32`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/zeno-glass.png" alt="" width={180} height={180} className="zeno-float h-32 w-32 drop-shadow-[0_0_50px_rgba(210,245,58,0.45)] sm:h-40 sm:w-40" />
        <h2 className="mt-8 max-w-3xl text-balance font-display text-[clamp(2.4rem,6vw,5rem)] font-semibold leading-[0.98] tracking-[-0.055em]">
          Every market. <span className="font-pixel font-bold text-[#d2f53a]">One view.</span>
        </h2>
        <p className="mt-5 max-w-xl text-[#a4a995]">Connect a wallet on Robinhood Chain and trade the first market in under a minute.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <CtaLink href="/markets">Launch app</CtaLink>
          <a href={X_URL} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 border border-[#eef2e2]/25 px-6 font-mono text-[13px] uppercase tracking-[0.14em] transition-colors duration-200 hover:bg-[#eef2e2] hover:text-ink">
            Follow @UseZenoMarkets
          </a>
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
      <MarketsExplorer markets={markets} />
      <Products markets={markets} />
      <Statement />
      <Contracts />
      <Roadmap />
      <Closing />
      <Footer />
    </>
  );
}
