"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MONO, SPACED_CAPS } from "@/lib/frame";
import { cn } from "@zeno/ui";
import { ArrowIcon } from "../ArrowIcon";
import { totalStars, useProgress, type ChapterDef, type Reward as RewardState } from "./kit";

/// The pop-up a visitor earns by finishing a chapter: stars land one by one, confetti bursts, the total
/// counts up. The motion is the point here, and it is allowed on this page only (docs/UI_CONTRACT.md Section 8).
/// With reduced motion every animation collapses and the pop-up simply appears.

const COLORS = ["bg-up", "bg-down", "bg-accent", "bg-muted", "bg-text"];
const LINES = ["", "Done. Take it again for all three stars.", "Nice run. One clean pass gets the third star.", "Flawless. Not a single misstep."];

const STAR = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z";

function useCountUp(from: number, to: number, delay: number) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }
    let frame = 0;
    const timer = setTimeout(() => {
      const start = performance.now();
      const run = (time: number) => {
        const p = Math.min((time - start) / 900, 1);
        setValue(Math.round(from + (to - from) * p));
        if (p < 1) frame = requestAnimationFrame(run);
      };
      frame = requestAnimationFrame(run);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [from, to, delay]);
  return value;
}

function Confetti({ count }: { count: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (Math.random() - 0.5) * 980,
        up: 140 + Math.random() * 280,
        fall: 320 + Math.random() * 420,
        r: (Math.random() - 0.5) * 1080,
        d: Math.random() * 320,
        t: 1900 + Math.random() * 1500,
        color: COLORS[i % COLORS.length]!,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        round: Math.random() < 0.3,
      })),
    [count],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none fixed left-1/2 top-[38%] z-[60] size-0">
      {pieces.map((piece, i) => (
        <span
          key={i}
          className={cn("how-confetti absolute left-0 top-0", piece.color, piece.round ? "rounded-full" : "rounded-[1px]")}
          style={{ width: piece.w, height: piece.h, animationDelay: `${piece.d}ms`, animationDuration: `${piece.t}ms`, "--x": `${piece.x}px`, "--up": `${piece.up}px`, "--fall": `${piece.fall}px`, "--r": `${piece.r}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}

function Dialog({ reward, chapters, onSelect }: { reward: RewardState; chapters: ChapterDef[]; onSelect: (id: string) => void }) {
  const { state, dispatch } = useProgress();
  const ref = useRef<HTMLDialogElement>(null);
  const index = chapters.findIndex((chapter) => chapter.id === reward.chapter);
  const chapter = chapters[index]!;
  const next = chapters[index + 1];
  const total = totalStars(state.stars);
  const max = chapters.length * 3;
  const shown = useCountUp(total - reward.gained, total, 1500);
  const everything = chapters.every((item) => (state.stars[item.id] ?? 0) > 0);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => dispatch({ type: "dismiss" });
  const goNext = () => {
    close();
    if (next) onSelect(next.id);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="reward-title"
      onClose={close}
      onClick={(event) => event.target === ref.current && ref.current.close()}
      className="how-pop m-auto max-h-[92dvh] w-[min(92vw,30rem)] overflow-y-auto overscroll-contain rounded-feature border border-line bg-surface p-0 text-text shadow-lift backdrop:bg-ground/70 backdrop:backdrop-blur-sm"
    >
      <Confetti count={reward.stars === 3 ? 110 : 70} />
      <div className="relative flex flex-col items-center px-6 pb-7 pt-9 text-center sm:px-9">
        <p className={cn(SPACED_CAPS, "text-muted")}>{everything ? "Every chapter done" : "Chapter complete"}</p>
        <h2 id="reward-title" className="mt-3 font-display text-[1.75rem] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[2.25rem]">
          {reward.stars === 3 ? "Flawless!" : reward.stars === 2 ? "Well played!" : "You did it!"}
        </h2>
        <p className="mt-1 text-muted">{chapter.title}</p>

        <div className="relative mt-7 flex items-center justify-center gap-2 sm:gap-3">
          <span aria-hidden="true" className="how-glow absolute size-40 rounded-full bg-accent/5" />
          {[1, 2, 3].map((n) => (
            <svg key={n} viewBox="0 0 24 24" aria-hidden="true" strokeWidth="1.25" strokeLinejoin="round" className={cn("relative size-14 sm:size-16", n <= reward.stars ? "how-star fill-accent-fg stroke-accent-fg" : "fill-none stroke-line")} style={n <= reward.stars ? { animationDelay: `${350 + (n - 1) * 380}ms` } : undefined}>
              <path d={STAR} />
            </svg>
          ))}
        </div>
        <p className="sr-only">{reward.stars} of 3 stars</p>
        <p className="mt-5 max-w-[22rem] text-sm leading-relaxed text-muted">{LINES[reward.stars]}</p>

        <dl className="mt-6 grid w-full grid-cols-2 divide-x divide-line rounded-control border border-line bg-ground py-3">
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-muted">Missteps</dt>
            <dd className={cn(MONO, "mt-1 text-xl")}>{reward.mistakes}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-muted">Total stars</dt>
            <dd className={cn(MONO, "mt-1 text-xl")}>
              ★ {shown}
              <span className="text-sm text-faint"> / {max}</span>
            </dd>
          </div>
        </dl>

        <div className="mt-6 grid w-full gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => dispatch({ type: "again", chapter: reward.chapter })} className="h-11 rounded-control border border-line bg-raised text-sm font-medium transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg">
            {reward.stars === 3 ? "Play again" : "Try for 3 stars"}
          </button>
          {next ? (
            <button type="button" onClick={goNext} className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
              Next: {next.eyebrow}
              <ArrowIcon />
            </button>
          ) : (
            <Link href="/perpetuals" className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press">
              Open App
              <ArrowIcon />
            </Link>
          )}
        </div>
        <button type="button" onClick={close} className="mt-3 text-xs text-faint underline underline-offset-2 transition-colors duration-150 hover:text-text">
          Close
        </button>
      </div>
    </dialog>
  );
}

export function Reward({ chapters, onSelect }: { chapters: ChapterDef[]; onSelect: (id: string) => void }) {
  const { state } = useProgress();
  if (!state.reward) return null;
  return <Dialog key={`${state.reward.chapter}-${state.attempts[state.reward.chapter] ?? 0}`} reward={state.reward} chapters={chapters} onSelect={onSelect} />;
}
