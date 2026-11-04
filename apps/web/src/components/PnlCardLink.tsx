"use client";

import { chip, cn } from "@zeno/ui";
import Link from "next/link";
import { useAccount } from "wagmi";

/// Where a position's PNL card lives. A position has a public URL under its wallet, which is what makes
/// it shareable. Nothing renders while there is no wallet to put in a URL.
export function PnlCardLink({ positionId, className, label = "PNL card" }: { positionId: bigint | string; className?: string; label?: string }) {
  const { address } = useAccount();
  const href = address ? `/pnl/${address.toLowerCase()}/${positionId}` : undefined;
  if (!href) return null;
  return (
    <Link href={href} className={cn(chip, "h-7 px-2.5 text-xs font-medium", className)}>
      {label}
    </Link>
  );
}
