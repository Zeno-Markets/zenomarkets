import assert from "node:assert/strict";
import { test } from "node:test";
import { createLeaderboard, LeaderboardHttpError, parseLeaderboard, parsePnlCard } from "./leaderboard.js";
import { NotImplementedError } from "./errors.js";

const board = {
  metric: "pnl",
  window: "all",
  sample: true,
  updatedAt: null,
  settlementDecimals: 6,
  total: 1,
  limit: 50,
  offset: 0,
  entries: [
    {
      rank: 1,
      wallet: "0xabc0000000000000000000000000000000000001",
      realisedPnl: "1250000000",
      unrealisedPnl: "-30000000",
      totalPnl: "1220000000",
      roiBps: "-1220",
      volume: "98000000000",
      tradeCount: 41,
      winRateBps: null,
      sample: true,
    },
  ],
};

test("a leaderboard restores bigints and keeps a null win rate null", () => {
  const parsed = parseLeaderboard(board);
  assert.equal(parsed.sample, true);
  assert.equal(parsed.updatedAt, null);
  assert.equal(parsed.entries[0]?.totalPnl, 1_220_000_000n);
  assert.equal(parsed.entries[0]?.unrealisedPnl, -30_000_000n);
  assert.equal(parsed.entries[0]?.roiBps, -1220n);
  assert.equal(parsed.entries[0]?.winRateBps, null);
});

test("a PNL card keeps an open position's missing prices null", () => {
  const card = parsePnlCard({
    wallet: "0xabc0000000000000000000000000000000000001",
    positionId: "12",
    kind: "perp",
    marketId: "0x4e56",
    symbol: "NVDA",
    side: "short",
    status: "open",
    leverage: 5,
    size: "5000000000",
    collateral: "1000000000",
    entryPrice: "190000000000000000000",
    exitPrice: null,
    markPrice: null,
    pricePnl: "0",
    fundingPnl: "-1200000",
    fees: "2500000",
    unrealisedPnl: null,
    totalPnl: "-3700000",
    roiBps: "-37",
    openedAt: "2026-10-05T09:00:00.000Z",
    closedAt: null,
    settlementDecimals: 6,
    sample: false,
  });
  assert.equal(card.positionId, 12n);
  assert.equal(card.exitPrice, null);
  assert.equal(card.markPrice, null);
  assert.equal(card.unrealisedPnl, null);
  assert.equal(card.totalPnl, -3_700_000n);
  assert.equal(card.side, "short");
});

test("the board asks for the metric, the window and the sample flag", async () => {
  let requested = "";
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response(JSON.stringify(board));
  }) as unknown as typeof fetch;
  await createLeaderboard("http://api.test").board({ metric: "roi", sample: true, limit: 10, offset: 20 });
  assert.equal(requested, "http://api.test/v1/leaderboard?metric=roi&window=all&limit=10&offset=20&sample=1");
});

test("a 404 card is a typed error and a missing apiUrl is not a fetch to undefined", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "no position" }), { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(
    createLeaderboard("http://api.test").pnlCard("0xABC0000000000000000000000000000000000001", 12n),
    (error: unknown) => error instanceof LeaderboardHttpError && error.status === 404,
  );
  await assert.rejects(createLeaderboard(undefined).board(), NotImplementedError);
});
