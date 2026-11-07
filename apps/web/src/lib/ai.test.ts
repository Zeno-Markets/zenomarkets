import assert from "node:assert/strict";
import { test } from "node:test";
import { failureText, fmtSourceTime, isLimit, suggestions, type AiFailure } from "./ai";

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

test("the suggestions name the open market", () => {
  const list = suggestions("NVDA");
  assert.equal(list.length, 3);
  assert.match(list[0]!, /NVDA/);
  assert.match(list[2]!, /funding rate/i);
});

test("a source time is UTC, and a bad one says so", () => {
  assert.equal(fmtSourceTime("2026-10-14T14:05:00.000Z"), "14:05 UTC, 14 Oct");
  assert.equal(fmtSourceTime("nonsense"), "time unknown");
});
