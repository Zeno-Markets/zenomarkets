"use client";

import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/// Small pointer effects for the landing page. Each one answers a mouse only (a finger scrolling past should not tilt
/// or drag things) and does nothing under reduced motion.

/// Writes the pointer's position over an element as `--px` / `--py` (0 to 1) on that element, for CSS to read.
export function pointerVars(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse") return;
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--px", ((event.clientX - rect.left) / rect.width).toFixed(3));
  el.style.setProperty("--py", ((event.clientY - rect.top) / rect.height).toFixed(3));
}

export function resetPointerVars(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty("--px");
  event.currentTarget.style.removeProperty("--py");
}

/// Pulls its child a little toward the pointer while the pointer is over it.
export function Magnetic({ children, strength = 0.25, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={ref}
      className={`inline-block transition-transform duration-300 ease-out ${className}`}
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== "mouse" || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) * strength;
        const dy = (event.clientY - (rect.top + rect.height / 2)) * strength;
        ref.current.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = "";
      }}
    >
      {children}
    </span>
  );
}

/// Tilts its child in 3D toward the pointer and moves a soft glare with it (`--gx` / `--gy`, read by the child).
export function Tilt({ children, max = 6, className = "" }: { children: ReactNode; max?: number; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`[perspective:1100px] ${className}`}
      onPointerMove={(event) => {
        if (reduced || event.pointerType !== "mouse" || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        ref.current.style.setProperty("--rx", `${((0.5 - y) * max * 2).toFixed(2)}deg`);
        ref.current.style.setProperty("--ry", `${((x - 0.5) * max * 2).toFixed(2)}deg`);
        ref.current.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
        ref.current.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
      }}
      onPointerLeave={() => {
        for (const name of ["--rx", "--ry", "--gx", "--gy"]) ref.current?.style.removeProperty(name);
      }}
    >
      <div className="h-full transition-transform duration-300 ease-out [transform-style:preserve-3d]" style={{ transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))" }}>
        {children}
      </div>
    </div>
  );
}

/// A line of display type whose letters jump and change colour under the pointer. Decorative: give the real text to
/// assistive tech next to it.
export function LetterHover({ text, className = "", hover = "hover:text-accent" }: { text: string; className?: string; hover?: string }) {
  return (
    <span aria-hidden className={className}>
      {text.split(" ").map((word, w) => (
        <Fragment key={w}>
          {w ? " " : null}
          <span className="inline-block whitespace-nowrap">
            {[...word].map((ch, i) => (
              <span key={i} className={`inline-block transition-[transform,color] duration-300 ease-out hover:-translate-y-[0.07em] hover:-rotate-3 ${hover}`}>
                {ch}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/// Dots down the right edge, one per landing section: the current one is lit, hovering one names it, pressing one
/// scrolls there. Wide screens only, where the content leaves the edge free.
export function SectionRail({ sections }: { sections: { id: string; label: string }[] }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const root = document.getElementById("main");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { root, rootMargin: "-45% 0px -50% 0px" },
    );
    for (const { id } of sections) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav aria-label="Page sections" className="fixed right-3 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 xl:flex">
      {sections.map(({ id, label }) => {
        const on = active === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={on ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
            }}
            className="group/rail relative flex size-5 items-center justify-center"
          >
            <span className={`block rounded-full border transition-all duration-300 ${on ? "size-3 border-ink bg-accent" : "size-2 border-ink/40 bg-paper group-hover/rail:scale-125 group-hover/rail:border-ink"}`} />
            <span className="pointer-events-none absolute right-7 whitespace-nowrap rounded-full bg-ink px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-paper opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 group-focus-visible/rail:opacity-100">
              {label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
