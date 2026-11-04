import { Num, toneOf } from "@zeno/ui";
import type { MarketStats } from "@zeno/sdk";
import { useMarketStats } from "@/hooks/queries";
import { symbolOf } from "@/lib/market";
import { useSparks } from "./zeno/data";

/// The indexer's statistics row for one market symbol. Its change needs 24 hours of samples; until then, or when the
/// on-chain price has not moved, the day's change of the real instrument stands in (display only).
export function useStatsFor(symbol: string): MarketStats | undefined {
  const { data } = useMarketStats();
  const spark = useSparks().data?.[symbol];
  const row = symbol ? data?.find((entry) => symbolOf(entry.marketId) === symbol) : undefined;
  const settled = row && row.change24hBps !== null && row.change24hBps !== 0 && row.changeWindowSeconds >= 86_400;
  if (settled || !spark) return row;
  const bps = Math.round(spark.changePct * 100) || (spark.changePct >= 0 ? 1 : -1);
  return { ...(row ?? ({} as MarketStats)), change24hBps: bps, changeWindowSeconds: 86_400 };
}

/// "+1.25%" or "−0.40%", from basis points.
export const fmtChange = (bps: number) => `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${(Math.abs(bps) / 100).toFixed(2)}%`;

/// "+1.25%" with the sign and market colour; a shorter-than-24h window is called out so a move
/// over twenty minutes is not mistaken for a day's.
export function Change({ stats, className }: { stats?: MarketStats; className?: string }) {
  if (!stats || stats.change24hBps === null) return null;
  const bps = stats.change24hBps;
  const text = fmtChange(bps);
  const partial = stats.changeWindowSeconds < 86_400;
  return (
    <Num
      tone={toneOf(bps)}
      className={className}
      title={partial ? `Change over the last ${Math.max(1, Math.round(stats.changeWindowSeconds / 60))} minutes; 24h of history is not collected yet` : undefined}
    >
      {text}
      {partial ? "*" : ""}
    </Num>
  );
}
