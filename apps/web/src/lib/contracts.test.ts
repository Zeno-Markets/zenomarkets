import assert from "node:assert/strict";
import { test } from "node:test";
// The web build chain is read when the module loads, so pin it to testnet (46630), whose record is complete.
process.env.NEXT_PUBLIC_CHAIN_ID = "46630";
const { ALL_CONTRACTS, CONTRACTS, LISTED_CONTRACTS } = await import("./contracts.js");

test("the full list is 50 contracts: every proxy with its implementation, the lending stack and the placeholder", () => {
  assert.equal(ALL_CONTRACTS.length, 50);
  assert.equal(ALL_CONTRACTS.filter((row) => row.implementation).length, 24);
  assert.equal(ALL_CONTRACTS.filter((row) => row.group === "Core").length, 41);
  assert.equal(ALL_CONTRACTS.filter((row) => row.group === "Lending").length, 9);
  assert.equal(new Set(ALL_CONTRACTS.map((row) => row.address.toLowerCase())).size, 50, "no address is listed twice");
});

test("the website lists proxies only: 25 on testnet, each under its Zeno contract name", () => {
  assert.equal(LISTED_CONTRACTS.length, 25);
  assert.ok(LISTED_CONTRACTS.every((row) => !row.implementation && !row.placeholder));
  assert.ok(LISTED_CONTRACTS.every((row) => row.contract.startsWith("Zeno")), "every listed contract carries the brand");
  assert.equal(LISTED_CONTRACTS.filter((row) => row.group === "Core").length, 20);
  assert.equal(LISTED_CONTRACTS.filter((row) => row.group === "Lending").length, 5);
});

test("the short list has one entry per product contract, 21 of them", () => {
  assert.equal(CONTRACTS.length, 21);
});
