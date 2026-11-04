import type { ReactNode } from "react";

/// An empty, loading, error or not-connected state that fills its panel: one sentence and one next
/// step, centred in the space the panel has, instead of a one-line strip at the top of a blank box.
export function PanelState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <p className="max-w-prose text-muted">{children}</p>
      {action}
    </div>
  );
}
