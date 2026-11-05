"use client";

import { cn, menuItem } from "@zeno/ui";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { env } from "@/lib/env";
import { NETWORK_CHOICES, networkName, switchNetwork } from "@/lib/network";

const item = cn(menuItem, "flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left");

/// The environment switcher: Robinhood Chain Testnet or Robinhood Chain Mainnet. The choice is kept in this
/// browser and the page reloads, so every read, address and link follows the network chosen.
export function NetworkMenu({ menuAbove = false }: { menuAbove?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${networkName(env.chainId)}. Open the network menu.`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-raised px-2.5 text-[10px] sm:px-3 sm:text-[11px] font-medium uppercase tracking-[0.1em] text-text transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
        {/* The full name needs more than a phone's bar has beside the logo, X and menu buttons. */}
        <span className="max-sm:hidden">{networkName(env.chainId)}</span>
        <span className="sm:hidden">{networkName(env.chainId).replace("Robinhood Chain ", "")}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6" className="h-1.5 w-2.5 fill-none stroke-current" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className={cn("absolute right-0 z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-panel border border-line bg-raised py-1", menuAbove ? "bottom-full mb-1" : "top-full mt-1")}>
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Network</p>
          {NETWORK_CHOICES.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === env.chainId}
              className={item}
              onClick={() => {
                close();
                if (id !== env.chainId) switchNetwork(id);
              }}
            >
              <span className="text-sm font-medium">{networkName(id)}</span>
              <span className="text-xs text-muted">{id === env.chainId ? "Selected." : "Switch and reload."} Chain {id}.</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
