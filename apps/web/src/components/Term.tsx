"use client";

import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type TermKey } from "@/lib/glossary";

/// A term with a dotted underline that explains itself on tap or click, and on keyboard focus plus Enter:
/// a small card with the meaning in plain words (`lib/glossary.ts`). It is a button, not a `title`
/// attribute, so it works on a phone. The card is drawn in a portal at a fixed position, so a panel
/// that scrolls or clips (the order panel, a table) cannot cut it off. Escape or a tap elsewhere closes it.
export function Term({ term, children }: { term: TermKey; children?: ReactNode }) {
  const entry = GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Outside press or Escape closes it. A press on the button itself is left to its own click, which
  // toggles, so the card does not close and reopen in one tap.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (card.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const width = Math.min(288, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPlace({ top: rect.bottom + 6, left });
    const hide = () => setOpen(false);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline min-h-0 min-w-0 cursor-help underline decoration-faint decoration-dotted underline-offset-4 transition-colors duration-150 hover:text-text hover:decoration-accent-fg"
      >
        {children ?? entry.title}
      </button>
      {open && place
        ? createPortal(
            <span
              ref={card}
              id={id}
              role="note"
              style={{ top: place.top, left: place.left, width: Math.min(288, window.innerWidth - 16) }}
              className="fixed z-[60] block rounded-panel border border-line bg-raised p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-text shadow-lift"
            >
              <span className="mb-1 block font-medium">{entry.title}</span>
              <span className="block text-muted">{entry.text}</span>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
