import assert from "node:assert/strict";
import { test } from "node:test";
import { failureText, fmtSourceTime, followUps, isLimit, revealParts, suggestions, type AiFailure } from "./ai";

test("every failure says what happened and what to do, in plain words", () => {
  const all: AiFailure[] = ["rate_limited", "busy", "daily_limit", "timeout", "unavailable", "disabled", "offline"];
  for (const failure of all) {
    const text = failureText(failure, 12);
    assert.ok(text.length > 20 && !/error|429|quota|exception|undefined/i.test(text), failure);
  }
});

test("a short wait is shown in seconds, a long one as a minute", () => {
  assert.match(failureText("busy", 7), /7 seconds/);
  assert.match(failureText("busy", 3_000), /in a minute/);
  assert.match(failureText("busy"), /in a minute/);
});

test("rate, busy and daily limit are the limit state", () => {
  assert.deepEqual((["rate_limited", "busy", "daily_limit", "timeout", "offline"] as AiFailure[]).filter(isLimit), ["rate_limited", "busy", "daily_limit"]);
});

test("the suggestions name the open market, and offer product questions without one", () => {
  const list = suggestions("NVDA");
  assert.equal(list.length, 4);
  assert.match(list[0]!, /NVDA/);
  assert.ok(list.some((question) => /copy trading/i.test(question)));
  assert.ok(suggestions().every((question) => !/undefined/.test(question)));
});

test("follow-ups are at most three and never repeat a question already asked", () => {
  const next = followUps("NVDA", ["latest news on nvda "]);
  assert.equal(next.length, 3);
  assert.ok(!next.includes("Latest news on NVDA"));
  assert.ok(followUps(undefined, []).every((question) => !/undefined/.test(question)));
});

test("revealParts joins back to the same text, line breaks kept", () => {
  const text = "NVDA is down 3.12%.\n\nRisk: prices move.";
  assert.equal(revealParts(text).join(""), text);
  assert.equal(revealParts(text).length, 7);
  assert.deepEqual(revealParts(""), []);
});

test("a source time is UTC, and a bad one says so", () => {
  assert.equal(fmtSourceTime("2026-10-14T14:05:00.000Z"), "14:05 UTC, 14 Oct");
  assert.equal(fmtSourceTime("nonsense"), "time unknown");
});
