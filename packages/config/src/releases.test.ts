import assert from "node:assert/strict";
import { test } from "node:test";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID } from "./chains.js";
import { isReleased, LATEST_RELEASE, releaseFor } from "./releases.js";

test("testnet runs every release, whatever the setting says", () => {
  for (const value of [undefined, "1", "2", "junk"]) assert.equal(releaseFor(ROBINHOOD_TESTNET_CHAIN_ID, value), LATEST_RELEASE);
});

test("mainnet runs the release it is set to, and V1.0 when the setting is missing or not a release", () => {
  assert.equal(releaseFor(ROBINHOOD_MAINNET_CHAIN_ID, "2"), 2);
  assert.equal(releaseFor(ROBINHOOD_MAINNET_CHAIN_ID, " 3 "), 3);
  assert.equal(releaseFor(ROBINHOOD_MAINNET_CHAIN_ID, "2.0"), 2);
  for (const value of [undefined, "", "0", "4", "2.5", "v2", "-1"]) assert.equal(releaseFor(ROBINHOOD_MAINNET_CHAIN_ID, value), 1, String(value));
});

test("each feature opens with its own release and stays open after it", () => {
  assert.deepEqual([1, 2, 3].map((r) => isReleased("lending", r)), [false, true, true]);
  assert.deepEqual([1, 2, 3].map((r) => isReleased("strategies", r)), [false, true, true]);
  assert.deepEqual([1, 2, 3].map((r) => isReleased("rfq", r)), [false, true, true]);
  assert.deepEqual([1, 2, 3].map((r) => isReleased("copyTrading", r)), [false, false, true]);
});
