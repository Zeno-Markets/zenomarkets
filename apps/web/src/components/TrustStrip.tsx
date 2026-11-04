"use client";

import { chains } from "@zeno/config";
import { Skeleton, cn } from "@zeno/ui";
import Link from "next/link";
import { usePerpMarkets } from "@/hooks/queries";
import { LISTED_CONTRACTS } from "@/lib/contracts";
import { env } from "@/lib/env";
import { MONO } from "@/lib/frame";
import { REGISTRY_ERROR } from "@/lib/market";

const label = "text-[11px] font-medium uppercase tracking-[0.2em] text-faint";
const value = cn(MONO, "text-base text-text");

/// What a visitor can check before anything else: how many markets are listed, how many contracts
/// are deployed and listed in full, which network. Every figure
/// is read from the registry, the deployment record or the environment, never typed in. While the
/// registry loads a figure is a skeleton, and when it cannot be read it reads "–" and says why.
export function TrustStrip({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  const markets = usePerpMarkets();
  return (
    <dl className={cn(stacked ? "grid grid-cols-1 gap-y-4" : "grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-[repeat(4,auto)] sm:justify-between", className)}>
      <div>
        <dt className={label}>Markets listed</dt>
        <dd className={value} title={markets.isError ? REGISTRY_ERROR : undefined}>
          {markets.isPending ? <Skeleton className="w-8" /> : markets.isError ? "–" : markets.data.length}
        </dd>
      </div>
      <div>
        <dt className={label}>Contracts</dt>
        <dd className={value}>
          <Link href="/#contracts" className="underline decoration-line underline-offset-4 transition-colors duration-150 hover:text-accent-fg">
            {`${LISTED_CONTRACTS.length} listed`}
          </Link>
        </dd>
      </div>
      <div>
        <dt className={label}>Network</dt>
        <dd className={value}>{chains[env.chainId].name}</dd>
      </div>
      <div>
        <dt className={label}>Source code</dt>
        <dd className={value}>
          <Link href="/docs#verify" className="underline decoration-line underline-offset-4 transition-colors duration-150 hover:text-accent-fg">
            Verified on Blockscout
          </Link>
        </dd>
      </div>
    </dl>
  );
}
