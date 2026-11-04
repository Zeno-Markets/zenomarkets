"use client";

import { ROBINHOOD_TESTNET_CHAIN_ID } from "@zeno/config";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { parseAbi, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { env } from "@/lib/env";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

/// Testnet only: mints the testnet asset straight to the connected wallet (ZenoTestToken has a public, capped
/// mint). Renders nothing on mainnet or without a wallet.
export function TestnetFaucet({ token, symbol, amount, decimals, className = "" }: { token: Address | undefined; symbol: string; amount: number; decimals: number; className?: string }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  if (env.chainId !== ROBINHOOD_TESTNET_CHAIN_ID || !address || !token) return null;
  async function mint() {
    setState("busy");
    try {
      const hash = await writeContractAsync({ address: token!, abi: mintAbi, functionName: "mint", args: [address!, parseUnits(String(amount), decimals)] });
      await client?.waitForTransactionReceipt({ hash });
      setState("done");
      void queryClient.invalidateQueries();
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }
  return (
    <button
      type="button"
      onClick={mint}
      disabled={state === "busy"}
      className={`group/faucet inline-flex h-9 items-center justify-center gap-2 border border-dashed border-accent-fg/60 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent-fg transition-all duration-200 hover:border-solid hover:bg-accent hover:text-accent-ink active:scale-[0.98] disabled:opacity-60 ${className}`}
    >
      <span aria-hidden className="size-1.5 bg-current transition-transform duration-300 group-hover/faucet:rotate-45" />
      {state === "busy" ? "Minting…" : state === "done" ? `+${amount.toLocaleString("en-US")} ${symbol}` : state === "failed" ? "Try again" : `Mint ${amount.toLocaleString("en-US")} test ${symbol}`}
    </button>
  );
}
