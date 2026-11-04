import type { Leaderboard, LeaderboardEntry, LeaderboardMetric } from "@zeno/sdk";

/// Orders a board the way the API does, so a board assembled here ranks exactly like the API's: by the chosen metric, descending, as a number;
/// ties on volume descending, then wallet ascending. Ranks are unique, 1-based.
export function rankEntries(entries: LeaderboardEntry[], metric: LeaderboardMetric): LeaderboardEntry[] {
  const value = (entry: LeaderboardEntry) => (metric === "pnl" ? entry.totalPnl : metric === "roi" ? entry.roiBps : entry.volume);
  return [...entries]
    .sort((a, b) => {
      const byMetric = value(b) === value(a) ? 0 : value(b) > value(a) ? 1 : -1;
      if (byMetric !== 0) return byMetric;
      if (b.volume !== a.volume) return b.volume > a.volume ? 1 : -1;
      return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/// Basis points as a signed percentage: 1250 -> "+12.50%".
export function fmtSignedBps(bps: bigint): string {
  const magnitude = Number(bps < 0n ? -bps : bps) / 100;
  const text = magnitude.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return bps === 0n ? `${text}%` : `${bps < 0n ? "−" : "+"}${text}%`;
}

export type { Leaderboard };
