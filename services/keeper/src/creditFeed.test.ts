import assert from "node:assert/strict";
import { test } from "node:test";
import { canSkipWrite, exceedsDeviation } from "./creditFeed.js";

test("a move past the oracle's per-update limit is flagged, the first price never is", () => {
  assert.equal(exceedsDeviation(100n, 116n, 1_500n), true);
  assert.equal(exceedsDeviation(100n, 115n, 1_500n), false);
  assert.equal(exceedsDeviation(0n, 999n, 1_500n), false);
});

test("a small move waits, a large move, an aged price and the first price are written", () => {
  assert.equal(canSkipWrite(10_000n, 10_199n, 3_599n, 200n, 3_600n), true);
  assert.equal(canSkipWrite(10_000n, 10_201n, 3_599n, 200n, 3_600n), false);
  assert.equal(canSkipWrite(10_000n, 9_799n, 3_599n, 200n, 3_600n), false);
  assert.equal(canSkipWrite(10_000n, 10_001n, 3_600n, 200n, 3_600n), false);
  assert.equal(canSkipWrite(0n, 10_001n, 0n, 200n, 3_600n), false);
});
