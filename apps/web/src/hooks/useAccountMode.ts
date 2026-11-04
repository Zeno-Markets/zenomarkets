"use client";

import { useAccount } from "wagmi";

/// Whether a wallet is connected. Every hook that reads or writes account data goes through this, so
/// there is one component tree: public data (markets, prices, the option chain) needs no wallet, and
/// anything of the person's own waits for `connected`.
export type AccountMode = "connected" | "disconnected";

export function useAccountMode(): AccountMode {
  const { isConnected } = useAccount();
  return isConnected ? "connected" : "disconnected";
}
