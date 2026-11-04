import assert from "node:assert/strict";
import { test } from "node:test";
import { fallToLiquidationBps, fmtHealth, healthBand, healthFactorBps, HF_NO_DEBT, liquidationPrice, ltvBps, statusSentence } from "./lending.js";

const USD = 10n ** 18n;

test("health factor follows the contract: collateral x liquidation LTV over debt, in basis points", () => {
  // $1,000 of collateral at a 70% liquidation LTV supports $700 of debt. $350 of debt is 2.00x.
  assert.equal(healthFactorBps(1_000n * USD, 350n * USD, 7_000n), 20_000n);
  // At exactly the line it is 1.00x, and one wei of extra debt tips it under.
  assert.equal(healthFactorBps(1_000n * USD, 700n * USD, 7_000n), 10_000n);
  assert.ok(healthFactorBps(1_000n * USD, 700n * USD + 10n ** 12n, 7_000n) < 10_000n);
});

test("the contract's two edge cases read the way the contract reads them", () => {
  assert.equal(healthFactorBps(1_000n * USD, 0n, 7_000n), HF_NO_DEBT);
  assert.equal(healthFactorBps(0n, 5n * USD, 7_000n), 0n);
  assert.equal(fmtHealth(HF_NO_DEBT), "–");
  assert.equal(fmtHealth(15_000n), "1.50x");
});

test("bands put the colour change where the contract draws the line", () => {
  assert.equal(healthBand(HF_NO_DEBT), "none");
  assert.equal(healthBand(20_000n), "safe");
  assert.equal(healthBand(15_000n), "safe");
  assert.equal(healthBand(14_999n), "watch");
  assert.equal(healthBand(11_999n), "danger");
  assert.equal(healthBand(10_000n), "danger");
  assert.equal(healthBand(9_999n), "liquidatable");
  assert.equal(healthBand(0n), "liquidatable");
});

test("how far the price can fall, and the price it falls to, agree with each other", () => {
  // 2.00x: the collateral can lose half its value.
  assert.equal(fallToLiquidationBps(20_000n), 5_000n);
  assert.equal(fallToLiquidationBps(10_000n), 0n);
  assert.equal(fallToLiquidationBps(HF_NO_DEBT), undefined);
  assert.equal(liquidationPrice(370n * USD, 20_000n), 185n * USD);
  assert.equal(liquidationPrice(370n * USD, HF_NO_DEBT), undefined);
});

test("loan to value is debt over collateral, and a paused pair gets a refusal sentence", () => {
  assert.equal(ltvBps(1_000n * USD, 600n * USD), 6_000n);
  assert.equal(ltvBps(0n, 5n), 0n);
  assert.match(statusSentence("PAUSED") ?? "", /refuses new supply and new borrowing/);
  assert.equal(statusSentence("NORMAL"), undefined);
});
