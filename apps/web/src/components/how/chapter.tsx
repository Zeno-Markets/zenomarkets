"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { MONO, SPACED_CAPS } from "@/lib/frame";
import { Panel, cn } from "@zeno/ui";
import { ArrowIcon } from "../ArrowIcon";
import { findTarget, GhostStage, targetOf } from "./ghost";
import { ChapterContext, PaneTitle, Stars, useProgress, type ChapterDef, type Step } from "./kit";

/// One chapter, laid out as a lesson. A stepper shows where the visitor is, a step card says what to do in plain
/// words, and the stage shows the same demo twice: on the left it plays the current step, on the right it is the
/// visitor's, with the next control highlighted. From 1280 px the two sit side by side. Below that they are tabs,
/// so each gets the full width instead of half of it. Finishing every step opens the reward.

const button = "inline-flex h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-colors duration-150";
const quiet = `${button} border border-line bg-raised hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg active:bg-accent active:text-accent-ink disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-line disabled:hover:bg-raised`;
const solid = `${button} bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-press`;

/// The dot of a step: a number, a tick once done, a pulsing ring while it is the one being worked on.
function Dot({ n, ok, here }: { n: number; ok: boolean; here: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        MONO,
        "relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm transition-[background-color,border-color,color] duration-150",
        ok ? "border-accent-fg bg-accent text-accent-ink" : here ? "how-ring border-accent-fg bg-ground text-text" : "border-line bg-surface text-muted",
      )}
    >
      {ok ? "✓" : n}
    </span>
  );
}

/// The steps as a list down the left of the lesson card, with every label in full. Hidden below `lg`, where the
/// row of dots takes its place.
function StepList({ steps, done, selected, onSelect }: { steps: Step[]; done: string[]; selected: number; onSelect: (index: number) => void }) {
  return (
    <ol aria-label="Steps" className="hidden lg:flex lg:flex-col">
      {steps.map((step, i) => {
        const ok = done.includes(step.id);
        const here = i === selected;
        return (
          <li key={step.id} className="relative">
            {i < steps.length - 1 ? <span aria-hidden="true" className={cn("absolute left-[1.1rem] top-9 h-[calc(100%-1.25rem)] w-0.5 rounded-full transition-colors duration-150", ok ? "bg-accent" : "bg-line")} /> : null}
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-current={here ? "step" : undefined}
              className={cn("group relative flex w-full items-start gap-3 rounded-control py-1.5 pr-3 text-left transition-colors duration-150", here ? "text-text" : "text-muted hover:text-text")}
            >
              <Dot n={i + 1} ok={ok} here={here} />
              <span className={cn("pt-1.5 text-sm leading-snug", here && "font-medium")}>
                {step.label}
                <span className="sr-only">{ok ? " (done)" : ""}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/// The same steps as a row of dots, for screens too narrow for the list.
function StepDots({ steps, done, selected, onSelect }: { steps: Step[]; done: string[]; selected: number; onSelect: (index: number) => void }) {
  return (
    <ol aria-label="Steps" className="flex items-center lg:hidden">
      {steps.map((step, i) => (
        <li key={step.id} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
          <button type="button" onClick={() => onSelect(i)} aria-current={i === selected ? "step" : undefined} className="rounded-full">
            <Dot n={i + 1} ok={done.includes(step.id)} here={i === selected} />
            <span className="sr-only">
              Step {i + 1}: {step.label}
              {done.includes(step.id) ? " (done)" : ""}
            </span>
          </button>
          {i < steps.length - 1 ? <span aria-hidden="true" className={cn("mx-1 h-0.5 min-w-3 flex-1 rounded-full transition-colors duration-150", done.includes(step.id) ? "bg-accent" : "bg-line")} /> : null}
        </li>
      ))}
    </ol>
  );
}

/// Marks the control the current step wants pressed, on the visitor's own demo. It looks again a few times a
/// second, because the control it points at changes as the demo moves on.
function Spotlight({ step, active, banner, children }: { step: Step; active: boolean; banner: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number }>();
  const spots = step.spot ?? step.acts.map(targetOf);

  useEffect(() => {
    if (!active) return setBox(undefined);
    const look = () => {
      const area = root.current;
      if (!area) return;
      const base = area.getBoundingClientRect();
      for (const spot of spots) {
        const el = findTarget(area, spot, true);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0) return setBox(undefined);
        const next = { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
        return setBox((prev) => (prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 && Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1 ? prev : next));
      }
      setBox(undefined);
    };
    look();
    const id = setInterval(look, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  return (
    <div ref={root} className="relative flex min-h-[26rem] flex-1 flex-col gap-5 p-4 sm:p-6">
      {banner}
      {children}
      {box ? (
        <span aria-hidden="true" className="how-ring pointer-events-none absolute z-10 rounded-control border-2 border-accent-fg transition-all duration-150" style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8 }}>
          <span className="absolute -top-2.5 right-2 rounded-sharp bg-accent px-1.5 text-[10px] font-medium uppercase leading-5 tracking-[0.1em] text-accent-ink">Here</span>
        </span>
      ) : null}
    </div>
  );
}

export function Chapter({ def, index, total, Demo, prev, next, onSelect }: { def: ChapterDef; index: number; total: number; Demo: ComponentType; prev?: ChapterDef; next?: ChapterDef; onSelect: (id: string) => void }) {
  const { state } = useProgress();
  const order = useMemo(() => def.steps.map((step) => step.id), [def]);
  const done = state.done[def.id] ?? [];
  const best = state.stars[def.id] ?? 0;
  const attempt = state.attempts[def.id] ?? 0;
  const [selected, setSelected] = useState(0);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<"watch" | "practice">("watch");
  const stage = useRef<HTMLDivElement>(null);
  const step = def.steps[selected]!;
  const stepDone = done.includes(step.id);

  // A finished step hands over to the next one that is not done, after a moment to see the tick.
  useEffect(() => {
    if (!done.includes(def.steps[selected]!.id)) return;
    const upcoming = def.steps.findIndex((item) => !done.includes(item.id));
    if (upcoming < 0) return;
    const id = setTimeout(() => setSelected(upcoming), 1100);
    return () => clearTimeout(id);
  }, [done.length, selected, def.steps]);

  useEffect(() => {
    if (attempt > 0) {
      setSelected(0);
      setTab("watch");
    }
  }, [attempt]);

  const show = (to: "watch" | "practice") => {
    setTab(to);
    requestAnimationFrame(() => stage.current?.scrollIntoView({ block: "nearest" }));
  };
  const choose = (i: number) => {
    setSelected(i);
    setReplay((value) => value + 1);
  };

  return (
    <section id={def.id} aria-labelledby={`${def.id}-title`} className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-[48rem]">
          <p className={cn(SPACED_CAPS, "text-muted")}>
            Chapter {String(index + 1).padStart(2, "0")} of {total} · {def.eyebrow}
          </p>
          <h2 id={`${def.id}-title`} className="mt-3 font-display text-[1.625rem] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem]">
            {def.title}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted">{def.lead}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {best > 0 ? (
            <p className="flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm text-muted">
              Best <Stars count={best} />
            </p>
          ) : null}
          {def.href ? (
            <Link href={def.href} className={cn(quiet, "group")}>
              {def.linkLabel}
              <ArrowIcon className="size-3 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          ) : def.soon ? (
            <p className="flex h-11 items-center rounded-control border border-line bg-surface px-3 text-sm text-muted">{def.soon}</p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-x-10 gap-y-6 rounded-feature border border-line bg-surface p-5 sm:p-7 lg:grid-cols-[minmax(0,19rem)_1fr]">
        <div className="lg:border-r lg:border-line lg:pr-8">
          <p className={cn(SPACED_CAPS, "mb-3 hidden text-muted lg:block")}>Your mission</p>
          <StepList steps={def.steps} done={done} selected={selected} onSelect={choose} />
          <StepDots steps={def.steps} done={done} selected={selected} onSelect={choose} />
        </div>
        <div className="flex flex-col justify-between gap-6">
          <div aria-live="polite">
            <p className={cn(SPACED_CAPS, stepDone ? "text-up" : "text-muted")}>
              Step {selected + 1} of {def.steps.length}
              {stepDone ? " · Done ✓" : ""}
            </p>
            <h3 className="mt-2 font-display text-[1.375rem] font-bold leading-snug tracking-[-0.02em] lg:hidden">{step.label}</h3>
            <p className="mt-2 max-w-[42rem] text-[1.0625rem] leading-relaxed text-text sm:text-lg lg:mt-3 lg:text-[1.25rem] lg:leading-snug">{step.hint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={quiet} disabled={selected === 0} onClick={() => choose(selected - 1)}>
              Back
            </button>
            <button
              type="button"
              className={stepDone && selected < def.steps.length - 1 ? quiet : solid}
              onClick={() => {
                setReplay((value) => value + 1);
                show("watch");
              }}
            >
              <span aria-hidden="true">▶</span> Show me
            </button>
            <button type="button" className={stepDone && selected < def.steps.length - 1 ? solid : quiet} disabled={selected === def.steps.length - 1} onClick={() => choose(selected + 1)}>
              Next step
            </button>
          </div>
        </div>
      </div>

      <div ref={stage} className="scroll-mt-4">
        <div role="tablist" aria-label="Watch or practice" className="mb-4 grid grid-cols-2 gap-1 rounded-control border border-line bg-surface p-1 xl:hidden">
          {(["watch", "practice"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => show(item)}
              className={cn("h-11 rounded-sharp text-sm font-medium transition-colors duration-150", tab === item ? "bg-accent text-accent-ink" : "text-muted hover:bg-accent-soft hover:text-accent-fg")}
            >
              {item === "watch" ? "1 · Watch" : `2 · Your turn (${done.length}/${def.steps.length})`}
            </button>
          ))}
        </div>

        <div className="grid items-stretch gap-6 xl:grid-cols-2">
          <div className={cn("min-w-0", tab === "watch" ? "block" : "hidden", "xl:block")}>
            <GhostStage steps={def.steps} selected={selected} attempt={attempt} replay={replay} onTry={() => show("practice")}>
              <ChapterContext.Provider value={{ id: def.id, order, ghost: true }}>
                <Demo />
              </ChapterContext.Provider>
            </GhostStage>
          </div>
          <div className={cn("min-w-0", tab === "practice" ? "block" : "hidden", "xl:block")}>
            <Panel title={<PaneTitle n={2}>Your turn</PaneTitle>} sample className="h-full">
              <Spotlight
                step={step}
                active={!stepDone}
                banner={
                  <p className="flex min-h-9 items-center gap-2 text-sm">
                    <span className={cn("shrink-0 rounded-sharp px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em]", stepDone ? "bg-up text-ground" : "bg-accent text-accent-ink")}>{stepDone ? "Done ✓" : `Step ${selected + 1}`}</span>
                    <span className="min-w-0 flex-1 text-muted">{stepDone ? "Nice. The next step is coming up." : step.label}</span>
                  </p>
                }
              >
                <ChapterContext.Provider value={{ id: def.id, order, ghost: false }}>
                  <Demo key={attempt} />
                </ChapterContext.Provider>
              </Spotlight>
            </Panel>
          </div>
        </div>
      </div>

      <nav aria-label="Chapters" className="grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
        {prev ? (
          <button type="button" onClick={() => onSelect(prev.id)} className="flex flex-col items-start rounded-panel border border-line/70 bg-surface p-4 text-left transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft">
            <span className={cn(SPACED_CAPS, "text-muted")}>← Previous</span>
            <span className="mt-1 font-display text-lg font-bold">{prev.eyebrow}</span>
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" onClick={() => onSelect(next.id)} className="flex flex-col items-start rounded-panel border border-line/70 bg-surface p-4 text-left transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft sm:items-end sm:text-right">
            <span className={cn(SPACED_CAPS, "text-muted")}>Next →</span>
            <span className="mt-1 font-display text-lg font-bold">{next.eyebrow}</span>
          </button>
        ) : null}
      </nav>
    </section>
  );
}
