"use client";

import { ROBINHOOD_MAINNET_CHAIN_ID, chains } from "@zeno/config";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";

/// Words that depend on the network chosen in the header. A server page is built for the build network only, so
/// anything on it that names the network goes through here and follows the choice in this browser.
export function ChainName() {
  return <>{chains[env.chainId].name}</>;
}

export function OnMainnet({ children, otherwise }: { children: ReactNode; otherwise?: ReactNode }) {
  return <>{env.chainId === ROBINHOOD_MAINNET_CHAIN_ID ? children : otherwise}</>;
}

export function ChainId() {
  return <>{env.chainId}</>;
}

/// A link to one deployed contract on the explorer of the chosen network, or nothing when there is none.
export function ExplorerLink({ of, className, children }: { of: "vault" | "settlementToken"; className?: string; children: ReactNode }) {
  const url = explorerAddressUrl(env.explorerUrl, env.addresses[of]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  ) : null;
}
