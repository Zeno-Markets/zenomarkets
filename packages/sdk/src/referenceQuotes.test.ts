import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchReferenceQuotes, parseReferenceQuote } from "./referenceQuotes.js";

test("a quote is the mid of bid and ask, with its change from the previous close", () => {
  const quote = parseReferenceQuote({ bid_price: "99.00", ask_price: "101.00", previous_close: "100", updated_at: "2026-10-08T15:00:00Z" });
  assert.deepEqual(quote, { price: 100, changeBps: 0, asOf: "2026-10-08T15:00:00Z" });
  assert.equal(parseReferenceQuote({ bid_price: "105", ask_price: "105", previous_close: "100", updated_at: "t" })?.changeBps, 500);
});

test("the last trade stands in for a missing side, and no price or no time is no quote", () => {
  assert.equal(parseReferenceQuote({ bid_price: null, ask_price: "10", last_trade_price: "9.5", updated_at: "t" })?.price, 9.5);
  assert.equal(parseReferenceQuote({ bid_price: "0", ask_price: "0", last_trade_price: null, updated_at: "t" }), undefined);
  assert.equal(parseReferenceQuote({ bid_price: "1", ask_price: "1" }), undefined);
  assert.equal(parseReferenceQuote({ bid_price: "1", ask_price: "1", updated_at: "t" })?.changeBps, null);
});

test("a stub book after hours reads the last trade; a tight book stays the mid; a wide book with no last trade stays the mid", () => {
  const stub = parseReferenceQuote({ bid_price: "82", ask_price: "555", last_trade_price: "85.345", previous_close: "83.92", updated_at: "t" });
  assert.deepEqual(stub, { price: 85.345, changeBps: 170, asOf: "t" });
  assert.equal(parseReferenceQuote({ bid_price: "54.12", ask_price: "54.75", last_trade_price: "54.6", updated_at: "t" })?.price, 54.435);
  assert.equal(parseReferenceQuote({ bid_price: "82", ask_price: "555", updated_at: "t" })?.price, 318.5);
});

test("many symbols in one request; an unknown symbol, a null result or a failed request is absent, never a throw", async () => {
  const realFetch = globalThis.fetch;
  let url = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    url = String(input);
    return new Response(JSON.stringify({ results: [{ symbol: "PDD", bid_price: "78", ask_price: "80", updated_at: "t" }, null] }));
  }) as typeof fetch;
  try {
    const quotes = await fetchReferenceQuotes(["PDD", "ZZZZ"]);
    assert.match(url, /\?symbols=PDD,ZZZZ$/);
    assert.deepEqual([...quotes.keys()], ["PDD"]);
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
    assert.equal((await fetchReferenceQuotes(["PDD"])).size, 0);
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await fetchReferenceQuotes(["PDD"])).size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
