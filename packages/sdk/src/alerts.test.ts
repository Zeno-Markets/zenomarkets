import assert from "node:assert/strict";
import { test } from "node:test";
import { alertFires, alertLabel, alertMessage, alertThreshold, fmtAlertPrice, notificationText, parseAlertValue } from "./alerts.js";

const WAD = 10n ** 18n;
const usd = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;

test("a price value becomes 18-decimal fixed point and a percent becomes whole basis points", () => {
  assert.deepEqual(parseAlertValue("price_above", "200"), { target: (200n * WAD).toString() });
  assert.deepEqual(parseAlertValue("price_below", "0.000001"), { target: (10n ** 12n).toString() });
  assert.deepEqual(parseAlertValue("pct_up", "5.25"), { target: "525" });
  assert.deepEqual(parseAlertValue("pct_down", "50"), { target: "5000" });
  for (const [kind, text] of [["price_above", "0"], ["price_above", "-3"], ["price_above", "1e3"], ["price_above", ""], ["pct_down", "100"], ["pct_up", "1000.01"], ["pct_up", "0"], ["pct_up", "2.555"]] as const) {
    assert.ok("error" in parseAlertValue(kind, text), `${kind} ${text}`);
  }
});

test("a price alert fires at its level and not before", () => {
  const above = { kind: "price_above", target: usd(200).toString(), basePrice: usd(190).toString() } as const;
  assert.equal(alertFires(above, usd(199.99)), false);
  assert.equal(alertFires(above, usd(200)), true);
  assert.equal(alertFires(above, usd(250)), true);
  const below = { kind: "price_below", target: usd(180).toString(), basePrice: usd(190).toString() } as const;
  assert.equal(alertFires(below, usd(180.01)), false);
  assert.equal(alertFires(below, usd(180)), true);
});

test("a percent alert is measured against the price recorded at creation", () => {
  const up = { kind: "pct_up", target: "500", basePrice: usd(200).toString() } as const;
  assert.equal(alertThreshold(up), usd(210));
  assert.equal(alertFires(up, usd(209.99)), false);
  assert.equal(alertFires(up, usd(210)), true);
  const down = { kind: "pct_down", target: "250", basePrice: usd(200).toString() } as const;
  assert.equal(alertThreshold(down), usd(195));
  assert.equal(alertFires(down, usd(195.01)), false);
  assert.equal(alertFires(down, usd(195)), true);
  // Measured from the creation price, not from wherever the market has moved since.
  assert.equal(alertFires({ ...up, basePrice: usd(100).toString() }, usd(150)), true);
});

test("the signed text names the wallet and the action, and its payload hash changes with any field", () => {
  const create = { action: "create", symbol: "NVDA", kind: "price_above", value: "200" } as const;
  const text = alertMessage("0xAbC0000000000000000000000000000000000001", create, 1_700_000_000);
  assert.match(text, /^Zeno price alerts: create\nWallet: 0xabc0/);
  assert.match(text, /Alert: NVDA at or above \$200\nPayload: 0x[0-9a-f]{64}\nIssued: 1700000000$/);
  const hashOf = (r: Parameters<typeof alertMessage>[1]) => alertMessage("0xabc", r, 1).split("\n")[3];
  assert.notEqual(hashOf(create), hashOf({ ...create, value: "201" }));
  assert.notEqual(hashOf(create), hashOf({ ...create, symbol: "AMD" }));
  assert.notEqual(hashOf(create), hashOf({ ...create, kind: "price_below" }));
  assert.notEqual(hashOf({ action: "cancel", id: 1 }), hashOf({ action: "cancel", id: 2 }));
});

test("prices and notifications read in plain words", () => {
  assert.equal(fmtAlertPrice(usd(1234.5)), "$1,234.50");
  assert.equal(fmtAlertPrice(10n ** 13n), "$0.00001");
  assert.equal(alertLabel("NVDA", "pct_up", "525", usd(190).toString()), "NVDA up 5.25% from $190.00");
  assert.deepEqual(notificationText({ symbol: "NVDA", kind: "price_above", target: usd(200).toString(), basePrice: usd(190).toString() }, usd(201.2)), {
    title: "NVDA at or above $200.00",
    body: "Now $201.20.",
  });
});
