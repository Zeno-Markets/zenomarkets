"use client";

import { type ReactNode, useEffect, useState } from "react";

const KEY = "zeno.disclosure.";

/// Detail that is there when you want it and out of the way when you do not: a native `<details>` whose
/// open state is remembered per device under `id`. Storage can be blocked, so every read and write is
/// guarded and the panel works without it.
export function Disclosure({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(KEY + id) === "1");
    } catch {
      // Blocked storage: stay closed.
    }
  }, [id]);
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        try {
          window.localStorage.setItem(KEY + id, next ? "1" : "0");
        } catch {
          // Blocked storage: the choice lasts for this visit only.
        }
      }}
      className="group border-t border-line pt-1"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm text-muted transition-colors duration-150 hover:text-text [&::-webkit-details-marker]:hidden">
        {label}
        <span aria-hidden="true" className="text-lg leading-none transition-transform duration-150 group-open:rotate-45">+</span>
      </summary>
      <div className="flex flex-col gap-3 pb-1 pt-1">{children}</div>
    </details>
  );
}
