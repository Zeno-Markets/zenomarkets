import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToHex } from "viem";
import { foldTraderStats, openPerpPositionIds, perpUnrealisedPnl, roiBps, type EventRow } from "./traderStats.js";
import { priceOpenPositions, type LiveReader } from "./traderStatsJob.js";

const ALICE = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const BOB = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const NVDA = "0x4e56444100000000000000000000000000000000000000000000000000000000";
const WAD = 10n ** 18n;
const usd = (n: number) => BigInt(n) * 10n ** 6n;
const NOW = 2_000_000_000;
const none = new Map<string, bigint>();
const base = { unrealisedByPosition: none, nowSeconds: NOW, optionGraceSeconds: 86_400 };

let tx = 0;
const ev = (eventName: string, args: Record<string, unknown>): EventRow => ({ txHash: `0x${(++tx).toString(16)}`, eventName, args });
const fee = (payer: string, amount: bigint, label: string) =>
  ev("ProtocolFeeCollected", { marketId: NVDA, payer, token: "0xtoken", amount: amount.toString(), feeType: stringToHex(label, { size: 32 }) });

function byWallet(stats: ReturnType<typeof foldTraderStats>, wallet: string) {
  const found = stats.find((s) => s.wallet === wallet.toLowerCase());
  assert.ok(found, `no stats for ${wallet}`);
  return found;
}

// Alice's life, worked out by hand (settlement token has 6 decimals, so usd(1) = 1_000_000):
//   open  long 5,000 notional on 1,000 margin ......... volume 5,000   capital 1,000   fee 2.5
//   reduce 2,000 of it, +40 price pnl ................. volume 7,000   realised +40
//   funding paid 3 ..................................... realised +37
//   close the remaining 3,000, +60 price pnl .......... volume 10,000  realised +97   (closed, a win: 40 - 3 + 60 > 0)
//   taker fees 2.5 + 1 + 1.5 (open, reduce, close) ..... realised +97 - 5 = +92
test("a perp position: volume, capital, realised PNL net of funding and fees, win rate", () => {
  const rows = [
    ev("PerpPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: usd(5_000), collateral: usd(1_000), leverage: "5", entryPrice: 190n * WAD }),
    fee(ALICE, 2_500_000n, "TAKER"),
    ev("PerpPositionUpdated", { positionId: "1", newSize: usd(3_000), newCollateral: usd(600), realizedPnlDelta: usd(40) }),
    fee(ALICE, 1_000_000n, "TAKER"),
    ev("FundingPaid", { positionId: "1", marketId: NVDA, amount: (-usd(3)).toString(), fundingIndex: "1" }),
    ev("PerpPositionClosed", { positionId: "1", realizedPnl: usd(60) }),
    fee(ALICE, 1_500_000n, "TAKER"),
  ].map((row) => ({ ...row, args: JSON.parse(JSON.stringify(row.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) }));

  const alice = byWallet(foldTraderStats(rows, base), ALICE);
  assert.equal(alice.volume, usd(10_000));
  assert.equal(alice.capitalDeployed, usd(1_000));
  assert.equal(alice.realisedPnl, usd(92));
  assert.equal(alice.unrealisedPnl, 0n);
  assert.equal(alice.tradeCount, 3);
  assert.equal(alice.closedCount, 1);
  assert.equal(alice.winRateBps, 10_000);
  assert.equal(alice.roiBps, 920n); // 92 / 1,000 = 9.20 %
});

test("added margin counts as capital, released margin does not reduce it", () => {
  const rows = [
    ev("PerpPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: "5000", collateral: "1000" }),
    ev("PerpPositionUpdated", { positionId: "1", newSize: "7000", newCollateral: "1400", realizedPnlDelta: "0" }),
    ev("PerpPositionUpdated", { positionId: "1", newSize: "2000", newCollateral: "400", realizedPnlDelta: "10" }),
  ];
  const alice = byWallet(foldTraderStats(rows, base), ALICE);
  assert.equal(alice.capitalDeployed, 1400n);
  assert.equal(alice.volume, 5000n + 2000n + 5000n);
});

test("a liquidation is a closed loss, and its fee counts against the wallet", () => {
  const rows = [
    ev("PerpPositionOpened", { positionId: "9", owner: BOB, marketId: NVDA, isLong: false, size: "10000", collateral: "1000" }),
    ev("PositionLiquidated", { positionId: "9", marketId: NVDA, owner: BOB, liquidator: ALICE, markPriceAtLiquidation: "1", pnl: "-950", fee: "20" }),
    fee(BOB, 20n, "LIQUIDATION"),
  ];
  const stats = foldTraderStats(rows, base);
  const bob = byWallet(stats, BOB);
  assert.equal(bob.realisedPnl, -970n);
  assert.equal(bob.winRateBps, 0);
  assert.equal(bob.closedCount, 1);
  // The liquidator is not a trader here: it opened nothing.
  assert.equal(stats.find((s) => s.wallet === ALICE.toLowerCase()), undefined);
});

test("open positions add their unrealised PNL to total, and ROI follows", () => {
  const rows = [ev("PerpPositionOpened", { positionId: "4", owner: ALICE, marketId: NVDA, isLong: true, size: "5000", collateral: "1000" })];
  const stats = foldTraderStats(rows, { ...base, unrealisedByPosition: new Map([["4", 250n]]) });
  const alice = byWallet(stats, ALICE);
  assert.equal(alice.realisedPnl, 0n);
  assert.equal(alice.unrealisedPnl, 250n);
  assert.equal(alice.roiBps, 2500n);
  assert.equal(alice.winRateBps, null, "nothing closed, so no win rate yet");
});

test("a position that closed does not take a stale unrealised figure", () => {
  const rows = [
    ev("PerpPositionOpened", { positionId: "4", owner: ALICE, marketId: NVDA, isLong: true, size: "5000", collateral: "1000" }),
    ev("PerpPositionClosed", { positionId: "4", realizedPnl: "10" }),
  ];
  const alice = byWallet(foldTraderStats(rows, { ...base, unrealisedByPosition: new Map([["4", 999n]]) }), ALICE);
  assert.equal(alice.unrealisedPnl, 0n);
});

test("options: closed PNL stands, exercise is net of premium, a worthless expiry loses the premium", () => {
  const past = String(NOW - 10 * 86_400);
  const rows = [
    ev("OptionPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, optionType: 0, strike: "1", expiry: past, contracts: "1", premium: "100" }),
    ev("OptionPositionClosed", { positionId: "1", owner: ALICE, realizedPnl: "30" }),
    ev("OptionPositionOpened", { positionId: "2", owner: ALICE, marketId: NVDA, optionType: 0, strike: "1", expiry: past, contracts: "1", premium: "100" }),
    ev("OptionExercised", { positionId: "2", intrinsicValue: "260", payout: "250" }),
    ev("OptionPositionOpened", { positionId: "3", owner: ALICE, marketId: NVDA, optionType: 1, strike: "1", expiry: past, contracts: "1", premium: "80" }),
    fee(ALICE, 3n, "OPTION_OPEN"),
    fee(ALICE, 7n, "OPTION_CLOSE"), // already inside realizedPnl, must not be taken twice
  ];
  const alice = byWallet(foldTraderStats(rows, base), ALICE);
  // +30, then +150 (250 - 100), then -80 (worthless), then -3 open fee.
  assert.equal(alice.realisedPnl, 30n + 150n - 80n - 3n);
  assert.equal(alice.closedCount, 3);
  assert.equal(alice.winRateBps, 6666);
  assert.equal(alice.volume, 280n);
});

test("an option inside the grace window is not written off yet", () => {
  const justExpired = String(NOW - 3_600);
  const rows = [ev("OptionPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, optionType: 0, strike: "1", expiry: justExpired, contracts: "1", premium: "100" })];
  const alice = byWallet(foldTraderStats(rows, base), ALICE);
  assert.equal(alice.realisedPnl, 0n);
  assert.equal(alice.closedCount, 0);
});

test("a wallet that only ever paid a fee is not on the board, and wallet case does not split an account", () => {
  const rows = [
    fee("0xdead", 5n, "TAKER"),
    ev("PerpPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: "10", collateral: "2" }),
    fee(ALICE.toLowerCase(), 1n, "TAKER"),
  ];
  const stats = foldTraderStats(rows, base);
  assert.equal(stats.length, 1);
  assert.equal(stats[0]?.realisedPnl, -1n);
});

test("events for a position the log never saw opened are ignored", () => {
  const rows = [ev("PerpPositionClosed", { positionId: "77", realizedPnl: "5" })];
  assert.deepEqual(foldTraderStats(rows, base), []);
});

test("openPerpPositionIds keeps only positions not yet closed or liquidated", () => {
  const rows = [
    ev("PerpPositionOpened", { positionId: "1", owner: ALICE }),
    ev("PerpPositionOpened", { positionId: "2", owner: ALICE }),
    ev("PerpPositionOpened", { positionId: "3", owner: BOB }),
    ev("PerpPositionClosed", { positionId: "1", realizedPnl: "0" }),
    ev("PositionLiquidated", { positionId: "3", owner: BOB, pnl: "0" }),
  ];
  assert.deepEqual(openPerpPositionIds(rows), ["2"]);
});

test("unrealised PNL matches MarginEngine.unrealizedPnl, rounding toward zero", () => {
  assert.equal(perpUnrealisedPnl(true, 190n * WAD, 209n * WAD, usd(5_000)), 500_000_000n); // +10 %
  assert.equal(perpUnrealisedPnl(false, 190n * WAD, 209n * WAD, usd(5_000)), -500_000_000n);
  assert.equal(perpUnrealisedPnl(true, 3n, 2n, 10n), -3n); // -10/3 truncates to -3, not -4
  assert.equal(perpUnrealisedPnl(true, 0n, 5n, 10n), 0n);
});

test("roi rounds toward zero and is 0 with no capital", () => {
  assert.equal(roiBps(-1n, 3n), -3333n);
  assert.equal(roiBps(5n, 0n), 0n);
});

test("priceOpenPositions prices open positions, skips closed ones, and survives a market with no mark", async () => {
  const reader: LiveReader = {
    getPerpPosition: async (id) => {
      if (id === 1n) return { open: true, isLong: true, marketId: NVDA, entryPrice: 100n * WAD, size: 1_000n };
      if (id === 2n) return { open: false, isLong: true, marketId: NVDA, entryPrice: 100n * WAD, size: 1_000n };
      if (id === 3n) return { open: true, isLong: false, marketId: "0xdead", entryPrice: 100n * WAD, size: 1_000n };
      throw new Error("rpc down");
    },
    getMarkPrice: async (marketId) => {
      if (marketId === NVDA) return 110n * WAD;
      throw new Error("MarketSessionClosed");
    },
  };
  const warnings: string[] = [];
  const result = await priceOpenPositions(["1", "2", "3", "4"], reader, 10, (m) => warnings.push(m));
  assert.deepEqual([...result], [["1", 100n]]);
  assert.equal(warnings.length, 2);
});

test("priceOpenPositions stops at the cap", async () => {
  const reader: LiveReader = {
    getPerpPosition: async () => ({ open: true, isLong: true, marketId: NVDA, entryPrice: WAD, size: 1n }),
    getMarkPrice: async () => WAD,
  };
  const result = await priceOpenPositions(["1", "2", "3"], reader, 2);
  assert.equal(result.size, 2);
});

test("perpNetByPosition adds price PNL and funding per position, the two sums the chain also keeps", async () => {
  const { perpNetByPosition } = await import("./traderStats.js");
  const rows = [
    ev("PerpPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: "10", collateral: "2" }),
    ev("FundingPaid", { positionId: "1", marketId: NVDA, amount: "-3", fundingIndex: "1" }),
    ev("PerpPositionUpdated", { positionId: "1", newSize: "5", newCollateral: "1", realizedPnlDelta: "40" }),
    ev("PerpPositionClosed", { positionId: "1", realizedPnl: "60" }),
    ev("PerpPositionOpened", { positionId: "2", owner: BOB, marketId: NVDA, isLong: false, size: "10", collateral: "2" }),
    ev("PositionLiquidated", { positionId: "2", owner: BOB, pnl: "-9" }),
  ];
  assert.deepEqual([...perpNetByPosition(rows)], [
    ["1", { owner: ALICE.toLowerCase(), net: 97n }],
    ["2", { owner: BOB.toLowerCase(), net: -9n }],
  ]);
});
