import assert from "node:assert/strict";
import { test } from "node:test";
import { capsProblem, usdToBase } from "./copy.js";

test("a typed dollar amount becomes base units, and anything else is refused", () => {
  assert.equal(usdToBase("100", 6), 100_000_000n);
  assert.equal(usdToBase("0.5", 18), 500_000_000_000_000_000n);
  assert.equal(usdToBase("0", 6), undefined);
  assert.equal(usdToBase("-5", 6), undefined);
  assert.equal(usdToBase("1.1234567", 6), undefined, "more places than the token has");
  assert.equal(usdToBase("abc", 6), undefined);
});

test("the caps are checked in order, and a per-trade limit above the total exposure is refused", () => {
  assert.match(capsProblem({ budget: undefined, maxTrade: 1n, maxExposure: 1n })!, /budget/);
  assert.match(capsProblem({ budget: 1n, maxTrade: undefined, maxExposure: 1n })!, /per trade/);
  assert.match(capsProblem({ budget: 1n, maxTrade: 1n, maxExposure: undefined })!, /exposure/);
  assert.match(capsProblem({ budget: 1n, maxTrade: 5n, maxExposure: 3n })!, /cannot be more/);
  assert.equal(capsProblem({ budget: 1n, maxTrade: 3n, maxExposure: 3n }), undefined);
});
