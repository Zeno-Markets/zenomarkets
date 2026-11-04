"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button.js";
import { cn } from "./cn.js";
import { Row } from "./Stat.js";

export interface ReviewRow {
  label: ReactNode;
  value: ReactNode;
  /// A figure the person must not miss: the total paid and the liquidation price.
  strong?: boolean;
}

export interface ReviewStepProps {
  title: string;
  rows: ReviewRow[];
  /// What goes wrong if the market turns, in one sentence.
  worstCase: string;
  /// Anything else the person should read before signing.
  note?: ReactNode;
  /// Back and Confirm. Left out, the review renders above the panel's own button (Pro): the worst case in
  /// full and every figure in a collapsed row (docs/UI_CONTRACT.md Section 7.1).
  onBack?: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
  /// Why Confirm is unavailable. Shown in place of nothing, never as a silently dead button.
  blocked?: string;
  className?: string;
}

/// The last screen before a wallet popup (docs/UI_CONTRACT.md rule 3): what you pay, what you get, the
/// liquidation price and the worst case. Focus moves to the heading, not to Confirm, so a held Enter key
/// from the form cannot sign the order.
export function ReviewStep({ title, rows, worstCase, note, onBack, onConfirm, confirmLabel = "Confirm", confirmVariant = "primary", busy = false, blocked, className }: ReviewStepProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const step = Boolean(onConfirm);
  useEffect(() => {
    if (step) heading.current?.focus();
  }, [step]);

  const figures = (
    <dl>
      {rows.map((row, index) => (
        <Row key={index} label={row.label} className={row.strong ? "font-medium" : undefined}>
          {row.value}
        </Row>
      ))}
    </dl>
  );

  return (
    <section aria-label={title} className={cn("flex flex-col gap-2", step && "rounded-panel border border-line p-3", className)}>
      {step ? (
        <h3 ref={heading} tabIndex={-1} className="text-sm font-medium">
          {title}
        </h3>
      ) : null}
      {step ? (
        figures
      ) : (
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted transition-colors duration-150 hover:text-text [&::-webkit-details-marker]:hidden">
            {title}
            <span aria-hidden="true" className="text-lg leading-none transition-transform duration-150 group-open:rotate-45">+</span>
          </summary>
          {figures}
        </details>
      )}
      <p className={cn("text-sm leading-snug", step && "border-t border-line pt-2")}>{worstCase}</p>
      {note ? <div className="text-xs leading-snug text-muted">{note}</div> : null}
      {blocked ? <p className="leading-snug text-down">{blocked}</p> : null}
      {step ? (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onBack}>
            Back
          </Button>
          <Button variant={confirmVariant} className="flex-1" disabled={busy || Boolean(blocked)} onClick={onConfirm}>
            {busy ? "Sending…" : confirmLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
