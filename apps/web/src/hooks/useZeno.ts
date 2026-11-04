"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { EIP1193Provider } from "viem";
import type { Zeno } from "@zeno/sdk";
import { useAccountMode } from "@/hooks/useAccountMode";
import { zenoWithWallet } from "@/lib/zeno";

/// The SDK client every action signs with, or `undefined` when there is nothing to sign with. Reads use
/// `zenoRead`; only actions that change something need this.
///
export function useWalletZeno(): Zeno | undefined {
  const mode = useAccountMode();
  const { address, connector, isConnected } = useAccount();
  const [client, setClient] = useState<Zeno>();

  useEffect(() => {
    let cancelled = false;
    if (mode !== "connected" || !isConnected || !address || !connector) {
      setClient(undefined);
      return;
    }
    void connector.getProvider().then((provider) => {
      if (!cancelled) setClient(zenoWithWallet(provider as EIP1193Provider, address));
    });
    return () => {
      cancelled = true;
    };
  }, [address, connector, isConnected, mode]);

  return client;
}
