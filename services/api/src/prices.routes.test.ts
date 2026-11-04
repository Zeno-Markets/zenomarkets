import assert from "node:assert/strict";
import test from "node:test";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, encodeErrorResult } from "viem";
import { priceStateFromRevert } from "./routes/prices.js";

const sessionClosedAbi = [
  { type: "error", name: "MarketSessionClosed", inputs: [{ name: "marketId", type: "bytes32" }] },
] as const;

const staleAbi = [{ type: "error", name: "StaleOraclePrice", inputs: [] }] as const;

const nvda = "0x4e56444100000000000000000000000000000000000000000000000000000000" as const;

/// Builds the error viem raises for a revert whose custom error is not in the ABI the call used —
/// exactly the shape `ZenoOracleRouter.getIndexPrice` produced on chain 4663 outside the equity
/// session: `signature` carries the 4-byte selector and `data` is undefined.
function revertOf(data: `0x${string}`) {
  const reverted = new ContractFunctionRevertedError({
    abi: [],
    data,
    functionName: "getIndexPrice",
  });
  const wrapper = new BaseError("The contract function reverted.", { cause: reverted });
  return wrapper;
}

test("a shut equity session reads as closed, not as a fault", () => {
  const data = encodeErrorResult({ abi: sessionClosedAbi, errorName: "MarketSessionClosed", args: [nvda] });
  assert.equal(priceStateFromRevert(revertOf(data)), "closed");
});

test("a price too old for its own session reads as stale", () => {
  const data = encodeErrorResult({ abi: staleAbi, errorName: "StaleOraclePrice" });
  assert.equal(priceStateFromRevert(revertOf(data)), "stale");
});

test("an unrecognised revert is a fault and keeps propagating", () => {
  assert.equal(priceStateFromRevert(revertOf("0xdeadbeef")), undefined);
});

test("a plain error is a fault, not a market state", () => {
  assert.equal(priceStateFromRevert(new Error("socket hang up")), undefined);
});

test("the selectors match the signatures in ZenoPriceValidator.sol", () => {
  const data = encodeErrorResult({ abi: sessionClosedAbi, errorName: "MarketSessionClosed", args: [nvda] });
  // The selector measured from the live revert on chain 4663.
  assert.equal(data.slice(0, 10), "0x2e4a0816");
  assert.deepEqual(decodeErrorResult({ abi: sessionClosedAbi, data }).args, [nvda]);
});
