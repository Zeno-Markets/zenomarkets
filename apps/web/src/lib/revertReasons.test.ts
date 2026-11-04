import assert from "node:assert/strict";
import { test } from "node:test";
import { allErrorsAbi, ZenoContractError, SlippageExceededError, UserRejectedError } from "@zeno/sdk";
import { errorMessage } from "@/stores/tx";
import { revertReason, revertReasons } from "./revertReasons.js";

const names = [...new Set(allErrorsAbi.filter((item) => item.type === "error").map((item) => item.name))];

test("every custom error the SDK can decode has a plain sentence", () => {
  assert.ok(names.length > 60, "the error ABI looks empty");
  const missing = names.filter((name) => !revertReasons[name]);
  assert.deepEqual(missing, [], `add a sentence to revertReasons.ts for: ${missing.join(", ")}`);
});

test("no sentence shows hex, a revert word or an error name", () => {
  for (const [name, sentence] of Object.entries(revertReasons)) {
    assert.match(sentence, /\.$/, name);
    assert.ok(sentence.split(" ").length >= 5, `${name} is too short to act on`);
    assert.doesNotMatch(sentence, /0x|revert|Error/i, name);
    assert.ok(!sentence.includes(name), `${name} leaks its own name`);
  }
});

test("a failed order says what happened and what to do, a declined signature says nothing was sent", () => {
  assert.equal(errorMessage(new SlippageExceededError("SlippageExceeded", [])), "The price moved past your slippage limit. Submit it again at the new price.");
  assert.match(errorMessage(new UserRejectedError("User rejected the request")), /declined.*Nothing was sent/);
});

test("an unmapped contract error gets the generic sentence plus its name; anything else never leaks wallet or hex text", () => {
  assert.match(errorMessage(new ZenoContractError("BrandNewError", [])), /\(BrandNewError\)/);
  assert.equal(revertReason("BrandNewError"), errorMessage(new ZenoContractError("BrandNewError", [])));
  for (const raw of [new Error("execution reverted: 0xdeadbeef"), new Error("MetaMask Tx Signature: User denied transaction signature."), "boom", undefined]) {
    const text = errorMessage(raw);
    assert.doesNotMatch(text, /0x|MetaMask|denied|reverted/i);
    assert.match(text, /Try again/);
  }
});
