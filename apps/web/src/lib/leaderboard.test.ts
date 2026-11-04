import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeaderboardEntry } from "@zeno/sdk";
import { fmtSignedBps, rankEntries } from "./leaderboard.js";

const entry = (wallet: string, totalPnl: bigint, volume: bigint): LeaderboardEntry => ({
  rank: 0,
  wallet,
  realisedPnl: totalPnl,
  unrealisedPnl: 0n,
  totalPnl,
  roiBps: 0n,
  volume,
  tradeCount: 1,
  winRateBps: null,
  sample: false,
});

test("ranking is by the metric as a number, ties on volume then wallet, ranks 1-based", () => {
  const ranked = rankEntries([entry("0xb", 5n, 10n), entry("0xa", 5n, 10n), entry("0xc", 5n, 99n), entry("0xd", 9n, 1n)], "pnl");
  assert.deepEqual(ranked.map((row) => row.wallet), ["0xd", "0xc", "0xa", "0xb"]);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 3, 4]);
});

test("basis points read as a signed percentage", () => {
  assert.equal(fmtSignedBps(1250n), "+12.50%");
  assert.equal(fmtSignedBps(-37n), "−0.37%");
  assert.equal(fmtSignedBps(0n), "0.00%");
});
