"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Panel, cn } from "@zeno/ui";
import { PaneTitle, type Act, type Step, type Target } from "./kit";

/// The "Watch" side of a chapter: the real demo, played by a cursor that nobody controls. It finds the buttons and
/// sliders in the demo it wraps and presses and drags them. It shows the step the visitor is on: it quietly does
/// the earlier steps, then performs this one slowly, pauses, and goes again. It can also play the whole chapter.
/// The copy is inert and hidden from assistive technology, and its events never score. It plays only while on
/// screen and starts paused for people who ask for less motion.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/// Finds a control inside a demo. With `skipChosen`, a button that is already selected is passed over, so a
/// highlight moves on to the next thing to press.
export function findTarget(root: HTMLElement, target: Target, skipChosen = false): HTMLElement | null {
  if ("css" in target) return root.querySelector<HTMLElement>(target.css);
  if ("range" in target) {
    const all = root.querySelectorAll<HTMLElement>("input[type=range]");
    return all[target.range < 0 ? all.length + target.range : target.range] ?? null;
  }
  const usable = (el: HTMLElement) =>
    !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true" && !(skipChosen && (el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-pressed") === "true"));
  return [...root.querySelectorAll<HTMLElement>("button,a")].find((el) => usable(el) && target.text.test((el.textContent ?? "").trim())) ?? null;
}

export const targetOf = (act: Act): Target => ("click" in act ? act.click : act.slide);

/// React tracks a controlled input's value itself, so a slider has to be set through the prototype setter and
/// told with a real `input` event, as a drag would.
export function setSlider(input: HTMLInputElement, value: number) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const THUMB = 8;

export function GhostStage({ steps, selected, attempt, replay, onTry, children }: { steps: Step[]; selected: number; attempt: number; replay: number; onTry: () => void; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  // The copy only ever grows taller, so after its first lap nothing below it jumps while the visitor works.
  const [floor, setFloor] = useState(0);
  const [run, setRun] = useState(0);
  const [tick, setTick] = useState(0);
  const [full, setFull] = useState(false);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState<"wait" | "step" | "done">("wait");
  const [now, setNow] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number; fast: boolean }>();
  const [ring, setRing] = useState<Box>();
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number }>();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting), { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new attempt starts the copy over, on step one.
  useEffect(() => {
    if (attempt > 0) {
      setFull(false);
      setPaused(false);
    }
  }, [attempt]);

  // "Show me" plays the current step again from the top.
  useEffect(() => {
    if (replay > 0) {
      setPaused(false);
      setTick((value) => value + 1);
    }
  }, [replay]);

  const playing = inView && !paused;

  useEffect(() => {
    if (!playing) {
      setCursor(undefined);
      setRing(undefined);
      placed.current = false;
      return;
    }
    let dead = false;
    const alive = () => !dead;
    const measure = () => setFloor((value) => Math.max(value, inner.current?.offsetHeight ?? 0));
    const boxOf = (el: HTMLElement): Box => {
      const b = el.getBoundingClientRect();
      const s = stage.current!.getBoundingClientRect();
      return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height };
    };
    const waitFor = async (target: Target) => {
      for (let i = 0; i < 30 && alive(); i++) {
        const el = stage.current ? findTarget(stage.current, target) : null;
        if (el) return el;
        await sleep(100);
      }
      return null;
    };
    const glide = async (to: { x: number; y: number }, fast = false) => {
      if (!placed.current) {
        // First move of a run: start from the corner so the cursor visibly travels in.
        setCursor({ x: stage.current!.clientWidth - 40, y: 24, fast: true });
        placed.current = true;
        await sleep(40);
      }
      setCursor({ ...to, fast });
      await sleep(fast ? 0 : 720);
    };

    /// An earlier step, done at once and unseen, so the step being shown starts from the right state.
    const quick = async (act: Act): Promise<boolean> => {
      const el = await waitFor(targetOf(act));
      if (!el) return alive();
      if ("click" in act) el.click();
      else setSlider(el as HTMLInputElement, act.to);
      await sleep(140);
      return alive();
    };

    const perform = async (act: Act): Promise<boolean> => {
      const el = await waitFor(targetOf(act));
      measure();
      if (!alive()) return false;
      if (!el) return true;
      const box = boxOf(el);
      if ("click" in act) {
        setRing(box);
        await glide({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
        if (!alive()) return false;
        setRipple({ x: box.x + box.w / 2, y: box.y + box.h / 2, id: Math.random() });
        el.click();
        await sleep(380);
        measure();
        setRing(undefined);
        return alive();
      }
      const input = el as HTMLInputElement;
      const min = Number(input.min);
      const max = Number(input.max);
      const unit = Number(input.step) || 1;
      const from = Number(input.value);
      const at = (value: number) => ({ x: box.x + THUMB + ((value - min) / (max - min)) * (box.w - 2 * THUMB), y: box.y + box.h / 2 });
      setRing(box);
      await glide(at(from));
      if (!alive()) return false;
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const frame = (time: number) => {
          if (!alive()) return resolve();
          const p = Math.min((time - start) / 1300, 1);
          const eased = 1 - (1 - p) ** 3;
          const value = Math.min(max, Math.max(min, Math.round((from + (act.to - from) * eased - min) / unit) * unit + min));
          setSlider(input, value);
          setCursor({ ...at(value), fast: true });
          if (p < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      await sleep(300);
      measure();
      setRing(undefined);
      return alive();
    };

    const show = async (index: number) => {
      setNow(index);
      setPhase("step");
      for (const act of steps[index]!.acts) if (!(await perform(act))) return false;
      return true;
    };

    (async () => {
      while (alive()) {
        placed.current = false;
        setRun((value) => value + 1);
        setPhase("wait");
        setCursor(undefined);
        setRing(undefined);
        await sleep(900);
        if (full) {
          for (let i = 0; i < steps.length && alive(); i++) {
            if (!(await show(i))) return;
            await sleep(700);
          }
        } else {
          for (let i = 0; i < selected && alive(); i++) for (const act of steps[i]!.acts) if (!(await quick(act))) return;
          if (!alive() || !(await show(selected))) return;
          await sleep(600);
        }
        if (!alive()) return;
        setPhase("done");
        setCursor(undefined);
        await sleep(full ? 4200 : 3600);
      }
    })();

    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, tick, selected, full]);

  const control = "h-8 rounded-control border border-line bg-raised px-2.5 text-xs font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg";
  const step = steps[now];

  return (
    <div ref={wrap} className="min-w-0">
      <Panel
        title={
          <span className="inline-flex items-center gap-3">
            <PaneTitle n={1}>Watch</PaneTitle>
            <span className={cn("inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em]", playing ? "text-down" : "text-faint")}>
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", playing ? "bg-down" : "bg-faint")} />
              {playing ? "Playing" : "Paused"}
            </span>
          </span>
        }
        actions={
          <>
            <button type="button" className={control} onClick={() => setPaused((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className={control}
              onClick={() => {
                setPaused(false);
                setTick((value) => value + 1);
              }}
            >
              Replay
            </button>
            <button
              type="button"
              className={control}
              aria-pressed={full}
              onClick={() => {
                setFull((value) => !value);
                setPaused(false);
              }}
            >
              {full ? "This step only" : "All steps"}
            </button>
          </>
        }
        className="h-full"
      >
        <div ref={stage} className="relative flex min-h-[26rem] flex-1 flex-col gap-5 overflow-hidden p-4 sm:p-6">
          <p className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {phase === "done" ? (
              <>
                <span className="shrink-0 rounded-sharp bg-up px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-ground">Shown</span>
                <span className="min-w-0 flex-1 text-muted">{full ? "That was every step. Now you try." : "Now you try."}</span>
                <button type="button" onClick={onTry} className="h-8 shrink-0 rounded-control bg-accent px-3 text-xs font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover xl:hidden">
                  Your turn →
                </button>
              </>
            ) : phase === "step" && step ? (
              <>
                <span className="shrink-0 rounded-sharp bg-accent px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-accent-ink">Step {now + 1}</span>
                <span key={now} className="how-pop min-w-0 flex-1 text-muted">
                  {step.label}
                </span>
              </>
            ) : (
              <span className="text-muted">{playing ? "Getting ready…" : paused ? "Paused. Press Play to watch." : "The demo starts when you scroll here."}</span>
            )}
          </p>
          <div key={run} ref={inner} inert aria-hidden="true" style={{ minHeight: floor || undefined }} className="pointer-events-none flex select-none flex-col gap-5">
            {children}
          </div>
          {ring ? <span aria-hidden="true" className="how-ring pointer-events-none absolute rounded-control border-2 border-accent-fg transition-all duration-150" style={{ left: ring.x - 3, top: ring.y - 3, width: ring.w + 6, height: ring.h + 6 }} /> : null}
          {ripple ? <span key={ripple.id} aria-hidden="true" className="how-ripple pointer-events-none absolute size-10 rounded-full bg-accent/30" style={{ left: ripple.x, top: ripple.y }} /> : null}
          {cursor ? (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={cn("pointer-events-none absolute left-0 top-0 z-10 size-8 ease-in-out drop-shadow-md transition-transform", cursor.fast ? "duration-75" : "duration-700")}
              style={{ transform: `translate(${cursor.x - 5}px, ${cursor.y - 3}px)` }}
            >
              <path d="M5 3l14 8-6 2-3 6z" className="fill-accent-fg stroke-ground" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
