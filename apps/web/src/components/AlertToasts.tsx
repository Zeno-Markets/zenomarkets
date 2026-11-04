"use client";

import { Button, cn, textLink } from "@zeno/ui";
import Link from "next/link";
import { useEffect } from "react";
import { playFillSound } from "@/lib/sound";
import { useAlertToasts } from "@/stores/alertToasts";

const SHOW_MS = 10_000;

/// A price alert that fired while the page was open: one calm card, top left on a wide screen (the free corner:
/// trigger alerts are top right, option expiry bottom left, transactions bottom right), with no animation.
/// It plays the same soft tone as a trigger fill unless sound is muted.
export function AlertToasts() {
  const toast = useAlertToasts((state) => state.toasts[0]);
  const dismiss = useAlertToasts((state) => state.dismiss);

  useEffect(() => {
    if (!toast) return;
    playFillSound("TRIGGER");
    const timer = setTimeout(() => dismiss(toast.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 top-24 z-50 sm:inset-x-auto sm:left-4 sm:w-96">
      {toast ? (
        <div className={cn("pointer-events-auto rounded-lg border border-line bg-raised p-4")}>
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted">Price alert</p>
          <p className="mt-1 text-base font-semibold">{toast.title}</p>
          <p className="mt-0.5 text-sm text-muted">{toast.body}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Link href="/alerts" className={cn("text-xs", textLink)} onClick={() => dismiss(toast.id)}>
              Manage alerts
            </Link>
            <Button variant="secondary" size="sm" onClick={() => dismiss(toast.id)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
