import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTabs, inGroup, perpLabel, symbolOf, tradeBlocker } from "./market.js";
import type { Hex } from "@zeno/types";

/// "NVDA" in ASCII, right-padded with zero bytes to 32 bytes, as the registry stores it.
const NVDA = "0x4e56444100000000000000000000000000000000000000000000000000000000" as Hex;

test("symbolOf strips the zero padding the registry adds", () => {
  assert.equal(symbolOf(NVDA), "NVDA");
  assert.equal(perpLabel(NVDA), "NVDA-PERP");
});

test("tradeBlocker refuses a paused market and nothing else", () => {
  assert.equal(tradeBlocker(true), undefined);
  assert.equal(tradeBlocker(undefined), undefined);
  assert.match(tradeBlocker(false) ?? "", /paused/i);
});

test("group tabs list only groups with markets, in order, and each tab shows its own rows", () => {
  const rows = [
    { symbol: "NVDA", group: "us-equities" as const },
    { symbol: "SPY", group: "etf" as const },
    { symbol: "BABA", group: "china" as const },
    { symbol: "USO", group: "commodities" as const },
    { symbol: "XYZ", group: undefined },
  ];
  assert.deepEqual(groupTabs(rows).map((tab) => tab.label), ["All", "US", "China", "Commodities", "ETF"]);
  assert.deepEqual(inGroup(rows, "all").map((row) => row.symbol), ["NVDA", "SPY", "BABA", "USO", "XYZ"]);
  assert.deepEqual(inGroup(rows, "china").map((row) => row.symbol), ["BABA"]);
  assert.deepEqual(inGroup(rows, "etf").map((row) => row.symbol), ["SPY"]);
  assert.deepEqual(inGroup(rows, "crypto"), []);
  assert.deepEqual(groupTabs([{ group: undefined }]), []);
});
