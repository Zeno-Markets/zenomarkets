import assert from "node:assert/strict";
import { test } from "node:test";
import { pickProtocolToken } from "./protocolToken.js";

const ADDRESS = "0x" + "ab".repeat(20);

test("the token is hidden by default, even when an address is recorded", () => {
  assert.equal(pickProtocolToken({ live: undefined, address: undefined, recordedAddress: ADDRESS }), undefined);
  assert.equal(pickProtocolToken({ live: "false", address: ADDRESS }), undefined);
  assert.equal(pickProtocolToken({ live: "", address: ADDRESS }), undefined);
});

test("once the flag is on, the environment wins over the recorded address", () => {
  const other = "0x" + "cd".repeat(20);
  assert.deepEqual(pickProtocolToken({ live: "true", address: other, recordedAddress: ADDRESS, recordedSymbol: "ZENO" }), { address: other, symbol: "ZENO" });
  assert.deepEqual(pickProtocolToken({ live: "TRUE", address: undefined, recordedAddress: ADDRESS, symbol: "HM" }), { address: ADDRESS, symbol: "HM" });
});

test("a malformed address is ignored even when the flag is on", () => {
  assert.equal(pickProtocolToken({ live: "true", address: "0x123" }), undefined);
  assert.equal(pickProtocolToken({ live: "true", address: undefined }), undefined);
});
