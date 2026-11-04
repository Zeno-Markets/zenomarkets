import assert from "node:assert/strict";
import { test } from "node:test";
import { exceedsDeviation } from "./creditFeed.js";

test("a move past the oracle's per-update limit is flagged, the first price never is", () => {
  assert.equal(exceedsDeviation(100n, 116n, 1_500n), true);
  assert.equal(exceedsDeviation(100n, 115n, 1_500n), false);
  assert.equal(exceedsDeviation(0n, 999n, 1_500n), false);
});
