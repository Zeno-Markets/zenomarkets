import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildPnlCard,
  compareRows,
  parseBoardQuery,
  parseVisibilityBody,
  parseWalletList,
  perpUnrealisedPnl,
  signatureMatches,
  symbolOfMarketId,
  syntheticBoard,
  visibilityMessage,
  type BoardQuery,
  type CardInput,
  type StatsRow,
} from "./leaderboard.js";

const WAD = 10n ** 18n;
const usd = (n: number) => BigInt(n) * 10n ** 6n;
const NVDA = "0x4e56444100000000000000000000000000000000000000000000000000000000";
const WALLET = `0x${"ab".repeat(20)}`;

test("the board query defaults, and rejects a bad metric, window, limit, offset or sample flag", () => {
  assert.deepEqual(parseBoardQuery({}), { metric: "pnl", window: "all", limit: 50, offset: 0, sample: false });
  assert.deepEqual(parseBoardQuery({ metric: "roi", limit: "100", offset: "50", sample: "1" }), { metric: "roi", window: "all", limit: 100, offset: 50, sample: true });
  for (const bad of [{ metric: "sharpe" }, { window: "24h" }, { limit: "0" }, { limit: "101" }, { limit: "1.5" }, { offset: "-1" }, { sample: "yes" }]) {
    assert.ok("error" in (parseBoardQuery(bad) as object), JSON.stringify(bad));
  }
});

test("a sample wallet list keeps only well-formed addresses, lowercased", () => {
  assert.deepEqual(parseWalletList(` ${WALLET.toUpperCase().replace("0X", "0x")} , nope ,0x12`), [WALLET]);
  assert.deepEqual(parseWalletList(undefined), []);
});

const row = (wallet: string, totalPnl: number, roiBps: number, volume: number): StatsRow => ({
  wallet,
  realisedPnl: String(totalPnl),
  unrealisedPnl: "0",
  totalPnl: String(totalPnl),
  roiBps: String(roiBps),
  volume: String(volume),
  tradeCount: 1,
  winRateBps: null,
});

test("ordering is numeric, not textual, and ties break on volume then wallet", () => {
  const rows = [row("0xc", 9, 0, 1), row("0xb", 10, 0, 5), row("0xa", 10, 0, 5), row("0xd", 10, 0, 7), row("0xe", -100, 0, 1)];
  assert.deepEqual(
    [...rows].sort(compareRows("pnl")).map((r) => r.wallet),
    ["0xd", "0xa", "0xb", "0xc", "0xe"], // 10 > 9 numerically, "9" > "10" as text
  );
});

test("the synthetic board is ranked per metric, paged, and labelled sample on every row", () => {
  const query: BoardQuery = { metric: "pnl", window: "all", limit: 5, offset: 0, sample: true };
  const board = syntheticBoard(query, 6);
  assert.equal(board.sample, true);
  assert.equal(board.updatedAt, null);
  assert.equal(board.total, 12);
  assert.equal(board.entries.length, 5);
  assert.ok(board.entries.every((entry) => entry.sample));
  assert.deepEqual(board.entries.map((e) => e.rank), [1, 2, 3, 4, 5]);
  const pnl = board.entries.map((e) => BigInt(e.totalPnl));
  assert.deepEqual([...pnl].sort((a, b) => (a < b ? 1 : -1)), pnl);

  const second = syntheticBoard({ ...query, offset: 5 }, 6);
  assert.deepEqual(second.entries.map((e) => e.rank), [6, 7, 8, 9, 10]);

  const roi = syntheticBoard({ ...query, metric: "roi", limit: 12 }, 6).entries.map((e) => BigInt(e.roiBps));
  assert.deepEqual([...roi].sort((a, b) => (a < b ? 1 : -1)), roi);
  const byPnl = syntheticBoard({ ...query, limit: 12 }, 6).entries.map((e) => e.wallet);
  const byRoi = syntheticBoard({ ...query, metric: "roi", limit: 12 }, 6).entries.map((e) => e.wallet);
  assert.notDeepEqual(byPnl, byRoi, "the three metrics must rank differently, or the board proves nothing");
  // A synthetic wallet is a well-formed address.
  assert.ok(board.entries.every((e) => /^0x[0-9a-f]{40}$/.test(e.wallet)));
});

test("a visibility body is validated field by field", () => {
  const good = { wallet: WALLET.toUpperCase().replace("0X", "0x"), hidden: true, issuedAt: 1_790_000_000, signature: "0xabcd" };
  const parsed = parseVisibilityBody(good);
  assert.ok(!("error" in parsed));
  assert.equal((parsed as { wallet: string }).wallet, WALLET);
  for (const bad of [null, "x", { ...good, wallet: "nope" }, { ...good, hidden: "true" }, { ...good, issuedAt: 1.5 }, { ...good, issuedAt: "1" }, { ...good, signature: "zz" }]) {
    assert.ok("error" in (parseVisibilityBody(bad) as object), JSON.stringify(bad));
  }
});

test("the visibility message is the exact text the frontend shows", () => {
  assert.equal(
    visibilityMessage("0xABC0000000000000000000000000000000000001", true, 1_790_000_000),
    "Zeno leaderboard visibility\nWallet: 0xabc0000000000000000000000000000000000001\nHidden: true\nIssued: 1790000000",
  );
});

test("a signature counts only from the wallet itself, over the same message", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const issuedAt = 1_790_000_000;
  const signature = await account.signMessage({ message: visibilityMessage(account.address, true, issuedAt) });
  const request = { wallet: account.address.toLowerCase(), hidden: true, issuedAt, signature };
  assert.equal(await signatureMatches(request), true);
  assert.equal(await signatureMatches({ ...request, hidden: false }), false, "the signed flag is part of the message");
  assert.equal(await signatureMatches({ ...request, issuedAt: issuedAt + 1 }), false, "so is the time");
  assert.equal(await signatureMatches({ ...request, wallet: WALLET }), false, "someone else's wallet cannot be hidden");
  assert.equal(await signatureMatches({ ...request, signature: "0x1234" }), false, "garbage is a bad signature, not a crash");
});

test("a market id reads back as its ticker", () => {
  assert.equal(symbolOfMarketId(NVDA), "NVDA");
});

test("unrealised PNL truncates toward zero like the contract", () => {
  assert.equal(perpUnrealisedPnl(true, 190n * WAD, 209n * WAD, usd(5_000)), usd(500));
  assert.equal(perpUnrealisedPnl(false, 190n * WAD, 209n * WAD, usd(5_000)), -usd(500));
  assert.equal(perpUnrealisedPnl(true, 3n, 2n, 10n), -3n);
});

const at = (iso: string) => new Date(iso);
const opened = {
  owner: WALLET,
  marketId: NVDA,
  isLong: true,
  size: usd(5_000).toString(),
  collateral: usd(1_000).toString(),
  leverage: "5",
  createdAt: at("2026-10-05T09:00:00Z"),
  txHash: "0x1",
};
const base = (over: Partial<CardInput>): CardInput => ({
  wallet: WALLET,
  positionId: "12",
  opened,
  later: [],
  fees: 0n,
  chain: { open: true, entryPrice: 190n * WAD, size: usd(5_000), collateral: usd(1_000) },
  markPrice: 209n * WAD,
  settlementDecimals: 6,
  sample: false,
  ...over,
});

test("an open position's card carries the live mark and unrealised PNL, net of fees and funding", () => {
  const card = buildPnlCard(
    base({
      later: [{ eventName: "FundingPaid", txHash: "0x2", args: { positionId: "12", amount: (-usd(3)).toString() }, createdAt: at("2026-10-05T10:00:00Z") }],
      fees: usd(2),
    }),
  );
  assert.equal(card.status, "open");
  assert.equal(card.side, "long");
  assert.equal(card.symbol, "NVDA");
  assert.equal(card.leverage, 5);
  assert.equal(card.markPrice, (209n * WAD).toString());
  assert.equal(card.exitPrice, null);
  assert.equal(card.closedAt, null);
  assert.equal(card.unrealisedPnl, usd(500).toString());
  assert.equal(card.pricePnl, "0");
  assert.equal(card.fundingPnl, (-usd(3)).toString());
  assert.equal(card.fees, usd(2).toString());
  assert.equal(card.totalPnl, usd(495).toString()); // 500 - 3 - 2
  assert.equal(card.roiBps, "4950"); // 495 / 1,000
});

test("an open position with no mark has no unrealised PNL, and says so", () => {
  const card = buildPnlCard(base({ markPrice: null }));
  assert.equal(card.status, "open");
  assert.equal(card.markPrice, null);
  assert.equal(card.unrealisedPnl, null);
  assert.equal(card.totalPnl, "0");
});

test("a closed position sums its reductions and close, and recovers the exit price of the closing fill", () => {
  // Long from 190: 2,000 reduced for +40, then the remaining 3,000 closed for +60. 60 = 3,000 * (exit - 190) / 190.
  const exit = 190n * WAD + (usd(60) * 190n * WAD) / usd(3_000);
  const card = buildPnlCard(
    base({
      later: [
        { eventName: "PerpPositionUpdated", txHash: "0x2", args: { positionId: "12", newSize: usd(3_000).toString(), newCollateral: usd(600).toString(), realizedPnlDelta: usd(40).toString() }, createdAt: at("2026-10-05T10:00:00Z") },
        { eventName: "PerpPositionClosed", txHash: "0x3", args: { positionId: "12", realizedPnl: usd(60).toString() }, createdAt: at("2026-10-05T11:30:00Z") },
      ],
      fees: usd(5),
      chain: { open: false, entryPrice: 190n * WAD, size: usd(3_000), collateral: usd(600) },
      markPrice: null,
    }),
  );
  assert.equal(card.status, "closed");
  assert.equal(card.pricePnl, usd(100).toString());
  assert.equal(card.unrealisedPnl, "0");
  assert.equal(card.markPrice, null);
  assert.equal(card.exitPrice, exit.toString());
  assert.equal(card.closedAt, "2026-10-05T11:30:00.000Z");
  assert.equal(card.totalPnl, usd(95).toString());
  assert.equal(card.roiBps, "950");
});

test("a short's exit price moves opposite to its profit", () => {
  const card = buildPnlCard(
    base({
      opened: { ...opened, isLong: false },
      later: [{ eventName: "PerpPositionClosed", txHash: "0x3", args: { positionId: "12", realizedPnl: usd(500).toString() }, createdAt: at("2026-10-05T11:30:00Z") }],
      chain: { open: false, entryPrice: 190n * WAD, size: usd(5_000), collateral: usd(1_000) },
    }),
  );
  assert.equal(card.side, "short");
  assert.equal(card.exitPrice, (171n * WAD).toString()); // 5,000 * (190 - 171) / 190 = 500
});

test("a liquidated position shows the liquidation mark and a closed unrealised of zero", () => {
  const card = buildPnlCard(
    base({
      later: [{ eventName: "PositionLiquidated", txHash: "0x4", args: { positionId: "12", markPriceAtLiquidation: (171n * WAD).toString(), pnl: (-usd(500)).toString() }, createdAt: at("2026-10-05T12:00:00Z") }],
      fees: usd(10),
      chain: { open: false, entryPrice: 190n * WAD, size: usd(5_000), collateral: usd(1_000) },
      markPrice: null,
    }),
  );
  assert.equal(card.status, "liquidated");
  assert.equal(card.exitPrice, (171n * WAD).toString());
  assert.equal(card.totalPnl, (-usd(510)).toString());
  assert.equal(card.roiBps, "-5100");
});

test("added margin enlarges the ROI denominator, and a sample wallet marks the card", () => {
  const card = buildPnlCard(
    base({
      later: [{ eventName: "PerpPositionUpdated", txHash: "0x2", args: { positionId: "12", newSize: usd(5_000).toString(), newCollateral: usd(2_000).toString(), realizedPnlDelta: "0" }, createdAt: at("2026-10-05T10:00:00Z") }],
      sample: true,
    }),
  );
  assert.equal(card.sample, true);
  assert.equal(card.roiBps, ((usd(500) * 10_000n) / usd(2_000)).toString());
});
