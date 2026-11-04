"use client";

import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode } from "react";
import { MONO, SPACED_CAPS } from "@/lib/frame";
import { cn } from "@zeno/ui";

/// Shared parts of the How it works demos. Every figure in a demo is an illustration, computed on the
/// page from the formulas in /docs and labelled as such. Nothing here reads the chain or moves money.

// ---------------------------------------------------------------- script types

/// Where the demo cursor goes: a button or link by its text, any element by CSS, or the n-th slider
/// (-1 is the last one).
export type Target = { text: RegExp } | { css: string } | { range: number };
export type Act = { click: Target } | { slide: Target; to: number };

/// One task of a chapter. The `acts` are what the demo on the left does to perform it, and the same `id`
/// is what the demo on the right reports through `useGoal` when the visitor does it.
export interface Step {
  id: string;
  label: string;
  /// One or two plain sentences: what to press and what it shows.
  hint: string;
  acts: Act[];
  /// What the practice side highlights for this step: the first of these that is on screen and not yet chosen.
  /// Defaults to the targets of `acts`.
  spot?: Target[];
}

export interface ChapterDef {
  id: string;
  /// The short name on the chapter bar and above the title.
  eyebrow: string;
  title: string;
  lead: string;
  steps: Step[];
  href?: string;
  linkLabel: string;
}

// ---------------------------------------------------------------- progress

const STORAGE_KEY = "zeno:how-it-works:v2";

export interface Reward {
  chapter: string;
  /// Stars earned by this run, 1 to 3.
  stars: number;
  mistakes: number;
  /// Stars this run added to the best-ever total of the chapter.
  gained: number;
}

interface State {
  done: Record<string, string[]>;
  mistakes: Record<string, number>;
  /// Best stars per chapter, kept on this device.
  stars: Record<string, number>;
  attempts: Record<string, number>;
  reward: Reward | null;
}

type Action =
  | { type: "load"; stars: Record<string, number> }
  | { type: "mark"; chapter: string; goal: string; order: string[] }
  | { type: "mistake"; chapter: string }
  | { type: "again"; chapter: string }
  | { type: "dismiss" }
  | { type: "reset" };

const EMPTY: State = { done: {}, mistakes: {}, stars: {}, attempts: {}, reward: null };

/// Three stars for a clean run, two for one or two missteps, one for more. A misstep is a task done before an
/// earlier one, or a blocked action the demo refuses and explains.
export const starsFor = (mistakes: number) => (mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1);

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return { ...state, stars: { ...action.stars, ...state.stars } };
    case "mistake":
      return { ...state, mistakes: { ...state.mistakes, [action.chapter]: (state.mistakes[action.chapter] ?? 0) + 1 } };
    case "mark": {
      const have = state.done[action.chapter] ?? [];
      if (have.includes(action.goal)) return state;
      const early = action.order.slice(0, action.order.indexOf(action.goal)).some((id) => !have.includes(id));
      const mistakes = { ...state.mistakes, [action.chapter]: (state.mistakes[action.chapter] ?? 0) + (early ? 1 : 0) };
      const done = { ...state.done, [action.chapter]: [...have, action.goal] };
      if (!action.order.every((id) => done[action.chapter]!.includes(id))) return { ...state, done, mistakes };
      const earned = starsFor(mistakes[action.chapter]!);
      const before = state.stars[action.chapter] ?? 0;
      const best = Math.max(before, earned);
      return { ...state, done, mistakes, stars: { ...state.stars, [action.chapter]: best }, reward: { chapter: action.chapter, stars: earned, mistakes: mistakes[action.chapter]!, gained: best - before } };
    }
    case "again":
      return { ...state, done: { ...state.done, [action.chapter]: [] }, mistakes: { ...state.mistakes, [action.chapter]: 0 }, attempts: { ...state.attempts, [action.chapter]: (state.attempts[action.chapter] ?? 0) + 1 }, reward: null };
    case "dismiss":
      return { ...state, reward: null };
    case "reset":
      return { ...EMPTY, attempts: Object.fromEntries(Object.entries(state.attempts).map(([id, n]) => [id, n + 1])) };
  }
}

interface ProgressValue {
  state: State;
  dispatch: (action: Action) => void;
}

const ProgressContext = createContext<ProgressValue>({ state: EMPTY, dispatch: () => {} });

export const useProgress = () => useContext(ProgressContext);

/// Remembers the best stars per chapter, on this device only. The page works the same when storage is
/// blocked: the stars then last for the visit.
export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, EMPTY);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "load", stars: JSON.parse(raw) as Record<string, number> });
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stars));
    } catch {}
  }, [state.stars]);

  return <ProgressContext.Provider value={{ state, dispatch }}>{children}</ProgressContext.Provider>;
}

/// Which chapter a demo is in. `ghost` marks the demo on the left, which performs the steps by itself: it
/// never scores, and it is invisible to assistive technology.
export const ChapterContext = createContext<{ id: string; order: string[]; ghost: boolean }>({ id: "", order: [], ghost: true });

/// Inside a chapter: `goal("review")` ticks that step.
export function useGoal() {
  const { id, order, ghost } = useContext(ChapterContext);
  const { dispatch } = useProgress();
  return useCallback((goal: string) => (ghost ? undefined : dispatch({ type: "mark", chapter: id, goal, order })), [id, order, ghost, dispatch]);
}

/// A step the demo refuses, such as a trade without the margin: it costs a star's worth of trust, not progress.
export function useMistake() {
  const { id, ghost } = useContext(ChapterContext);
  const { dispatch } = useProgress();
  return useCallback(() => (ghost ? undefined : dispatch({ type: "mistake", chapter: id })), [id, ghost, dispatch]);
}

export const totalStars = (stars: Record<string, number>) => Object.values(stars).reduce((sum, n) => sum + n, 0);

/// The title of one side of the stage: a numbered dot and a name, so "watch, then do" reads as a sequence.
export function PaneTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={cn(MONO, "flex size-5 items-center justify-center rounded-full bg-accent text-[11px] text-accent-ink")}>
        {n}
      </span>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- stars

export function Stars({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("inline-flex gap-0.5", className)} role="img" aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((n) => (
        <svg key={n} viewBox="0 0 24 24" aria-hidden="true" className={cn("size-4", n <= count ? "fill-accent-fg stroke-accent-fg" : "fill-none stroke-line")} strokeWidth="1.5" strokeLinejoin="round">
          <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
        </svg>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- controls

export function Slider({ label, value, min, max, step = 1, onChange, display }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; display?: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className={cn(MONO, "text-text")}>{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 block h-11 w-full cursor-pointer accent-accent"
      />
    </label>
  );
}

/// A row of choices. Selected is the solid accent fill, as everywhere else in the app.
export function Choice<T extends string | number>({ label, options, value, onChange, tone }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; tone?: (value: T) => "up" | "down" | undefined }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const on = option.value === value;
        const t = tone?.(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-11 min-w-11 flex-1 rounded-control px-3 text-sm font-medium transition-colors duration-150 sm:h-10",
              on ? (t === "up" ? "bg-up text-ground" : t === "down" ? "bg-down text-ground" : "bg-accent text-accent-ink") : "bg-raised text-muted hover:bg-accent-soft hover:text-accent-fg active:bg-accent active:text-accent-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/// A label and a figure on one line, for review cards and read-outs.
export function Line({ label, children, strong }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-sm", strong && "font-medium")}>
      <dt className="text-muted">{label}</dt>
      <dd className={cn(MONO, "text-right text-text")}>{children}</dd>
    </div>
  );
}

export function Note({ tone, children }: { tone?: "up" | "down"; children: ReactNode }) {
  return (
    <p
      role="status"
      className={cn("rounded-control border px-3 py-2.5 text-sm leading-relaxed", tone === "up" ? "border-up-line bg-up-soft text-text" : tone === "down" ? "border-down-line bg-down-soft text-text" : "border-line bg-raised text-muted")}
    >
      {children}
    </p>
  );
}

/// The review card every money-moving demo passes through before its "signature" (UI contract rule 3).
export function Review({ title = "Review before you sign", children, onBack, onConfirm, confirmLabel = "Sign in wallet" }: { title?: string; children: ReactNode; onBack: () => void; onConfirm: () => void; confirmLabel?: string }) {
  return (
    <div className="rounded-panel border border-accent-line bg-ground p-4">
      <p className={cn(SPACED_CAPS, "text-muted")}>{title}</p>
      <dl className="mt-2 divide-y divide-line">{children}</dl>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" onClick={onBack} className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
          Back
        </button>
        <button type="button" onClick={onConfirm} className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
          {confirmLabel}
        </button>
      </div>
      <p className="mt-3 text-xs text-faint">Practice mode: no wallet opens on this page.</p>
    </div>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} aria-current={index === current ? "step" : undefined} className={cn("flex items-center gap-2 transition-colors duration-150", index === current ? "text-text" : index < current ? "text-muted" : "text-faint")}>
          <span className={cn(MONO, "flex size-5 items-center justify-center rounded-full border text-[11px]", index <= current ? "border-accent-fg bg-accent text-accent-ink" : "border-line")}>{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- numbers

const usdFormat = (digits: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
const USD = [usdFormat(0), usdFormat(2)];

export const usd = (value: number, digits: 0 | 2 = 2) => USD[digits === 0 ? 0 : 1]!.format(value);
export const signed = (value: number, digits: 0 | 2 = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${usd(Math.abs(value), digits)}`;
export const pct = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(digits)}%`;
export const tone = (value: number) => (value > 0 ? "up" : value < 0 ? "down" : "neutral") as "up" | "down" | "neutral";

// ---------------------------------------------------------------- charts

/// A fixed, scripted price path through waypoints `[time 0..1, price]`, with a small deterministic wobble so it
/// reads like a market. Same inputs, same path, so a demo is repeatable.
export function scenario(waypoints: [number, number][], length: number) {
  return Array.from({ length }, (_, i) => {
    const t = i / (length - 1);
    let k = 1;
    while (k < waypoints.length - 1 && waypoints[k]![0] < t) k++;
    const [t0, p0] = waypoints[k - 1]!;
    const [t1, p1] = waypoints[k]!;
    const base = p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
    return base + Math.sin(i * 1.7) * 0.25 * Math.sin(Math.PI * t);
  });
}

const LINE_TONE = { up: "border-up text-up", down: "border-down text-down", accent: "border-accent-fg text-text", muted: "border-muted text-muted" } as const;
export type LineTone = keyof typeof LINE_TONE;

export interface ChartLine {
  at: number;
  label: string;
  tone: LineTone;
}

export interface ChartMark {
  index: number;
  price: number;
  tone: "up" | "down" | "accent";
  label: string;
}

/// A price path on a plain frame. Lines are HTML so their labels stay readable at 375 px. The path is
/// drawn up to `upTo`; the rest shows faint, so a visitor sees where the scenario is heading.
export function PriceChart({ prices, upTo, min, max, lines = [], marks = [], className }: { prices: number[]; upTo: number; min: number; max: number; lines?: ChartLine[]; marks?: ChartMark[]; className?: string }) {
  const last = prices.length - 1;
  const x = (i: number) => (i / last) * 100;
  const y = (p: number) => 100 - ((p - min) / (max - min)) * 100;
  const path = (from: number, to: number) => prices.slice(from, to + 1).map((p, i) => `${i === 0 ? "M" : "L"}${x(from + i).toFixed(2)} ${y(p).toFixed(2)}`).join(" ");
  const now = Math.min(upTo, last);
  return (
    <div className={cn("relative h-52 w-full overflow-hidden rounded-control border border-line bg-ground sm:h-60", className)} role="img" aria-label="Price chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        <path d={path(0, last)} fill="none" className="stroke-line" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={path(0, now)} fill="none" className="stroke-text" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {lines.map((line) => (
        <div key={line.label} className={cn("pointer-events-none absolute inset-x-0 border-t border-dashed", LINE_TONE[line.tone])} style={{ top: `${y(line.at)}%` }}>
          <span className="absolute right-1 -translate-y-full rounded-sharp bg-ground/90 px-1 text-[11px] leading-4">{line.label}</span>
        </div>
      ))}
      {marks
        .filter((mark) => mark.index <= now)
        .map((mark) => (
          <span
            key={mark.label}
            className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ground", mark.tone === "up" ? "bg-up" : mark.tone === "down" ? "bg-down" : "bg-accent", "size-3")}
            style={{ left: `${x(mark.index)}%`, top: `${y(mark.price)}%` }}
            title={mark.label}
          />
        ))}
      <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ground bg-text" style={{ left: `${x(now)}%`, top: `${y(prices[now]!)}%` }} />
    </div>
  );
}

/// Profit and loss against a price: the curve, a zero line, green above it and red below. `marker` is the
/// price a visitor is dragging; the dot sits on the curve there.
export function PayoffChart({ fn, from, to, marker, className }: { fn: (price: number) => number; from: number; to: number; marker: number; className?: string }) {
  const steps = 120;
  const xs = Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);
  const ys = xs.map(fn);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const pad = (hi - lo || 1) * 0.12;
  const min = lo - pad;
  const max = hi + pad;
  const px = (price: number) => ((price - from) / (to - from)) * 100;
  const py = (value: number) => 100 - ((value - min) / (max - min)) * 100;
  const line = xs.map((price, i) => `${i === 0 ? "M" : "L"}${px(price).toFixed(2)} ${py(ys[i]!).toFixed(2)}`).join(" ");
  const zero = py(0);
  const area = `${line} L100 ${zero} L0 ${zero} Z`;
  const id = `clip-${Math.round(zero * 100)}`;
  return (
    <div className={cn("relative h-52 w-full overflow-hidden rounded-control border border-line bg-ground sm:h-60", className)} role="img" aria-label="Profit and loss at expiry">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-up`}>
            <rect x="0" y="0" width="100" height={zero} />
          </clipPath>
          <clipPath id={`${id}-down`}>
            <rect x="0" y={zero} width="100" height={100 - zero} />
          </clipPath>
        </defs>
        <path d={area} className="fill-up-soft" clipPath={`url(#${id}-up)`} />
        <path d={area} className="fill-down-soft" clipPath={`url(#${id}-down)`} />
        <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-muted" strokeDasharray="2 2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" className="stroke-text" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <line x1={px(marker)} x2={px(marker)} y1="0" y2="100" className="stroke-accent-fg" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute left-1 rounded-sharp bg-ground/90 px-1 text-[11px] leading-4 text-muted" style={{ top: `calc(${zero}% - 1.1rem)` }}>
        Break-even line
      </span>
      <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ground bg-text" style={{ left: `${px(marker)}%`, top: `${py(fn(marker))}%` }} />
      <span className={cn(MONO, "pointer-events-none absolute bottom-1 left-1 text-[11px] text-faint")}>{usd(from, 0)}</span>
      <span className={cn(MONO, "pointer-events-none absolute bottom-1 right-1 text-[11px] text-faint")}>{usd(to, 0)}</span>
    </div>
  );
}
