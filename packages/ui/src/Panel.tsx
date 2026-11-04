import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";
import { SampleBadge } from "./SampleBadge.js";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  /// The panel shows simulated figures: it carries a `SAMPLE DATA` mark in its header. Set it from the
  /// account mode, on every panel that holds a balance or a position.
  sample?: boolean;
}

/// A softly rounded region of the terminal. A hairline border and a fill lighter than the page, not
/// shadows, set it apart.
export function Panel({ title, actions, sample = false, className, children, ...props }: PanelProps) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-panel border border-line/70 bg-surface", className)} {...props}>
      {title || actions || sample ? (
        <header className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 border-b border-line px-3">
          <h2 className="min-w-0 max-w-full text-sm">{title}</h2>
          {sample || actions ? (
            <div className="flex items-center gap-2">
              {sample ? <SampleBadge /> : null}
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
