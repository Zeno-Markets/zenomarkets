import assert from "node:assert/strict";
import { test } from "node:test";
import { quotedRows } from "./quoted.js";

test("quoted rows list every display-only China and US name, with or without a token, and no trade fields", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const symbols = new URL(String(input)).searchParams.get("symbols")!.split(",");
    return new Response(
      JSON.stringify({ results: symbols.map((symbol) => ({ symbol, bid_price: "100", ask_price: "102", previous_close: "101", updated_at: "2026-10-08T00:00:00Z" })) }),
    );
  }) as typeof fetch;
  try {
    const rows = await quotedRows(1);
    assert.equal(rows.length, 38);
    assert.deepEqual(rows.slice(0, 4).map((r) => r.symbol), ["UMC", "FUTU", "EWT", "SIMO"]);
    assert.ok(rows.every((r) => r.tier === "quoted" && r.price === 101 && r.changeBps === 0 && (r.group === "china" || r.group === "us-equities")));
    assert.deepEqual(rows.slice(-7).map((r) => r.symbol), ["NFLX", "AVGO", "CRM", "COST", "BA", "ADBE", "QCOM"]);
    assert.ok(rows.slice(0, 4).every((r) => r.token), "a tokenized name keeps its token");
    assert.ok(rows.filter((r) => r.symbol === "PDD" || r.symbol === "JD").every((r) => r.token === null), "a name with no token has null");
  } finally {
    globalThis.fetch = realFetch;
  }
});
