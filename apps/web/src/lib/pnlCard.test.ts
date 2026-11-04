import assert from "node:assert/strict";
import { test } from "node:test";
import { cardProps, type CardParts } from "./pnlCard.js";

const USD = 10n ** 6n;
const PRICE = 10n ** 18n;
const parts = (over: Partial<CardParts> = {}): CardParts => ({
  symbol: "NVDA",
  isLong: true,
  leverage: 5,
  status: "closed",
  totalPnl: 495n * USD,
  roiBps: 990n,
  entryPrice: 200n * PRICE,
  exitPrice: 220n * PRICE,
  size: 5_000n * USD,
  decimals: 6,
  sample: false,
  ...over,
});

test("a closed winner reads as a gain with its sign, entry, exit and size", () => {
  const props = cardProps(parts());
  assert.equal(props.pnl, "+$495.00");
  assert.equal(props.direction, "gain");
  assert.equal(props.entry, "$200.00");
  assert.equal(props.exit, "$220.00");
});

test("a liquidation is its own status and a loss, never a plain close", () => {
  const props = cardProps(parts({ status: "liquidated", totalPnl: -1_000n * USD }));
  assert.equal(props.status, "liquidated");
  assert.equal(props.direction, "loss");
});

test("a missing exit price is a dash", () => {
  assert.equal(cardProps(parts({ status: "open", exitPrice: null })).exit, undefined);
});

test("a card that rounds to zero is flat, not a gain or a loss", () => {
  const props = cardProps(parts({ totalPnl: 1n, roiBps: 0n, exitPrice: PRICE, entryPrice: PRICE }));
  assert.equal(props.direction, "flat");
  assert.equal(props.sample, false);
});
