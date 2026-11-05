"use client";

import { chip, cn, menuItem } from "@zeno/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useDismiss } from "@/hooks/useDismiss";
import { useNotifications } from "@/hooks/useAlerts";
import { readSeen, timeAgo, writeSeen } from "@/lib/alerts";
import { env } from "@/lib/env";
import { useAlertToasts } from "@/stores/alertToasts";

/// The bell in the header: price alerts that fired for the connected wallet, with an unread count. It polls every 30
/// seconds while a wallet is connected. "Unread" is what this browser has not yet seen, kept in its own storage, so
/// reading needs no signature. A new alert that arrives while the page is open also appears as a toast.
export function NotificationBell() {
  const { address } = useAccount();
  const { data, isError } = useNotifications(address);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const toasted = useRef<{ wallet: string; id: number } | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const push = useAlertToasts((state) => state.push);

  useEffect(() => {
    if (address) setSeen(readSeen(address));
  }, [address]);

  const list = data?.notifications ?? [];
  const newest = list[0]?.id ?? 0;

  // The first answer after a page load or a wallet change only sets the badge; later ones toast what is new.
  useEffect(() => {
    if (!data || !address) return;
    const wallet = address.toLowerCase();
    if (toasted.current?.wallet === wallet) {
      const fresh = data.notifications.filter((item) => item.id > (toasted.current?.id ?? 0)).reverse();
      if (fresh.length > 0) push(fresh);
    }
    toasted.current = { wallet, id: Math.max(newest, toasted.current?.wallet === wallet ? toasted.current.id : 0) };
  }, [data, address, newest, push]);

  if (!address || !env.apiUrl) return null;
  const unread = list.filter((item) => item.id > seen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && address && newest > seen) {
      setSeen(newest);
      writeSeen(address, newest);
    }
  }

  return (
    <div ref={ref} className="sm:relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Price alerts, ${unread} unread` : "Price alerts"}
        onClick={toggle}
        className={cn(chip, "relative size-10 shrink-0 justify-center rounded-full!")}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4">
          <path d="M5 8a5 5 0 0110 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8zM8.5 16.5a1.6 1.6 0 003 0" />
        </svg>
        {unread > 0 ? (
          <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="menu" className="absolute inset-x-4 top-full z-50 mt-1 max-h-[70dvh] overflow-y-auto rounded-panel border border-line bg-raised py-1 sm:inset-x-auto sm:right-0 sm:w-80">
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Price alerts</p>
          {isError ? (
            <p className="px-3 py-3 text-sm text-muted">Alerts could not be loaded. They will try again in a moment.</p>
          ) : list.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">Nothing has fired yet. Set an alert and it shows up here.</p>
          ) : (
            list.slice(0, 8).map((item) => (
              <Link key={item.id} href="/alerts" role="menuitem" onClick={close} className={cn(menuItem, "flex min-h-11 flex-col justify-center px-3 py-1.5")}>
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted">
                  {item.body} {timeAgo(item.createdAt)}
                </span>
              </Link>
            ))
          )}
          <Link href="/alerts" role="menuitem" onClick={close} className={cn(menuItem, "flex min-h-11 items-center border-t border-line px-3 text-sm font-medium")}>
            Manage alerts
          </Link>
        </div>
      ) : null}
    </div>
  );
}
