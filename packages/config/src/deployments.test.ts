import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { addressesForChain, hasDeployment, implementationRecords, OPTIONAL_CONTRACTS, protocolTokens, resolveAddresses } from "./deployments.js";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID } from "./chains.js";

const ADDRESS = `0x${"ab".repeat(20)}`;

test("without overrides the recorded deployment is returned", () => {
  assert.deepEqual(resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, {}), addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID));
});

test("overrides replace only the named contracts", () => {
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ZENO_ADDRESSES: JSON.stringify({ optionsEngine: ADDRESS }) });
  const recorded = addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID);
  assert.equal(resolved.optionsEngine, ADDRESS);
  assert.equal(resolved.vault, recorded.vault);
});

test("a typo or malformed value is an error, never a silent fallback", () => {
  const resolve = (value: unknown) =>
    resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ZENO_ADDRESSES: JSON.stringify(value) });
  assert.throws(() => resolve({ optionEngine: ADDRESS }), /unknown contract "optionEngine"/);
  assert.throws(() => resolve({ optionsEngine: "0x123" }), /is not an address/);
  assert.throws(() => resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ZENO_ADDRESSES: "{not json" }), /not valid JSON/);
});

test("an optional contract (one added after older deployments) is a known override key", () => {
  // `perpOrderManager` is absent from deployments made before limit orders, so a fresh or local
  // deployment must be able to supply it even when the recorded one does not have it.
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ZENO_ADDRESSES: JSON.stringify({ perpOrderManager: ADDRESS }) });
  assert.equal(resolved.perpOrderManager, ADDRESS);
  assert.ok(OPTIONAL_CONTRACTS.includes("perpOrderManager"));
});

test("mainnet is deployed from V1.0 on the real USDG, and no protocol token is recorded until ZENO launches", () => {
  assert.equal(hasDeployment(ROBINHOOD_MAINNET_CHAIN_ID), true);
  assert.equal(hasDeployment(ROBINHOOD_TESTNET_CHAIN_ID), true);
  assert.equal(addressesForChain(ROBINHOOD_MAINNET_CHAIN_ID).settlementToken, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  assert.deepEqual(protocolTokens, {});
});

test("the recorded implementations match the deployment files, and every one sits behind a recorded proxy", () => {
  for (const [chainId, network] of [[ROBINHOOD_TESTNET_CHAIN_ID, "robinhood_testnet"], [ROBINHOOD_MAINNET_CHAIN_ID, "robinhood_mainnet"]] as const) {
    const file = JSON.parse(readFileSync(resolvePath(import.meta.dirname, `../../contracts/deployments/${network}.implementations.json`), "utf8")) as Record<string, string>;
    const record = implementationRecords[chainId]!;
    for (const [key, address] of Object.entries(file)) {
      assert.equal(record.implementations[key as keyof typeof record.implementations], address, `${network} ${key}: run a sync or update deployments.ts`);
    }
    const proxies = addressesForChain(chainId);
    for (const key of Object.keys(record.implementations)) assert.ok(key in proxies, `${network}: implementation ${key} has no proxy recorded`);
  }
});
