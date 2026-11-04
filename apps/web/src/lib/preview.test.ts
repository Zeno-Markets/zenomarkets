import assert from "node:assert/strict";
import { test } from "node:test";
import { TAPE_MAX, TAPE_MIN, TAPE_PATH, clampTape, longLiquidationPrice, moveTo, nearestTapeStep, priceAfter, scaleByPct } from "./preview.js";

test("a 5x long with a 5% maintenance rate is liquidated 15% under entry", () => {
  assert.ok(Math.abs(longLiquidationPrice(250, 5, 0.05) - 212.5) < 1e-9);
});

test("1x with no maintenance margin can only be liquidated at zero", () => {
  assert.equal(longLiquidationPrice(100, 1, 0), 0);
});

test("more leverage moves the liquidation price closer to entry", () => {
  assert.ok(longLiquidationPrice(100, 10, 0.05) > longLiquidationPrice(100, 3, 0.05));
});

test("the 5x long's liquidation is the 15% fall the tape script goes through", () => {
  assert.ok(Math.abs(moveTo(250, longLiquidationPrice(250, 5, 0.05)) + 15) < 1e-9);
});

test("the script stays inside the tape's range and starts and ends at entry", () => {
  assert.ok(TAPE_PATH.every((pct) => pct >= TAPE_MIN && pct <= TAPE_MAX));
  assert.equal(TAPE_PATH[0], 0);
  assert.equal(TAPE_PATH[TAPE_PATH.length - 1], 0);
  assert.ok(TAPE_PATH.some((pct) => pct <= -15), "the script takes the 5x long through its liquidation");
});

test("price and move are inverses, and the clamp holds at both ends", () => {
  assert.equal(priceAfter(200, 25), 250);
  assert.equal(moveTo(200, 250), 25);
  assert.equal(clampTape(-99), TAPE_MIN);
  assert.equal(clampTape(99), TAPE_MAX);
});

test("collateral scales with the move without losing the integer arithmetic", () => {
  const usd = 10n ** 18n;
  assert.equal(scaleByPct(1_000n * usd, 0), 1_000n * usd);
  assert.equal(scaleByPct(1_000n * usd, -30), 700n * usd);
  assert.equal(scaleByPct(1_000n * usd, 12.5), 1_125n * usd);
});

test("Play resumes from the script point nearest the scrubbed price", () => {
  assert.equal(nearestTapeStep(0), 0);
  assert.equal(nearestTapeStep(-29), TAPE_PATH.indexOf(-30));
});
