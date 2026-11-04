/// Runs the alert engine against a real PostgreSQL that already has the indexer's schema
/// (`pnpm --filter @zeno/indexer db:migrate`). Skipped unless TEST_DATABASE_URL is set. The tables are emptied
/// first: point it at a scratch database, never a real one.
///
///   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/zeno_test pnpm --filter @zeno/indexer test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveMarketId } from "@zeno/sdk";
import postgres from "postgres";
import { evaluateAlerts, type PushSender } from "./alerts.js";

const url = process.env.TEST_DATABASE_URL;
const usd = (n: number) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString();
const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const config = { maxPriceAgeMs: 15 * 60_000, retentionDays: 30 };
const quiet = () => {};

describe("price alerts against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  const sql = postgres(url as string);
  let issued = 0;

  async function reset() {
    await sql`truncate price_alerts, notifications, push_subscriptions, price_ticks, markets restart identity`;
    issued = 0;
  }
  async function market(symbol: string, active = true) {
    await sql`insert into markets (market_id, underlying_token, oracle_id, options_enabled, perps_enabled, max_leverage, open_interest_cap, active, block_number)
      values (${resolveMarketId(symbol)}, '0x1', '0x2', false, true, '10', '0', ${active}, 1)`;
  }
  const tick = (symbol: string, price: string, ageMs = 0) =>
    sql`insert into price_ticks (market_id, price, sampled_at) values (${resolveMarketId(symbol)}, ${price}, ${new Date(Date.now() - ageMs)})`;
  async function alert(wallet: string, symbol: string, kind: string, target: string, base = usd(190)) {
    const [row] = await sql<{ id: number }[]>`insert into price_alerts (wallet, symbol, kind, target, base_price, issued_at) values (${wallet}, ${symbol}, ${kind}, ${target}, ${base}, ${++issued}) returning id`;
    return row?.id as number;
  }
  const subscribe = (wallet: string, endpoint: string) => sql`insert into push_subscriptions (endpoint, wallet, p256dh, auth) values (${endpoint}, ${wallet}, 'p', 'a')`;
  const count = async (table: "notifications" | "price_alerts") => Number((await sql.unsafe(`select count(*)::int as n from ${table}`))[0]?.n);

  test("a crossed alert fires once even with two runners at the same time, and a later pass sends nothing", async () => {
    await reset();
    await market("NVDA");
    await tick("NVDA", usd(201));
    const id = await alert(ALICE, "NVDA", "price_above", usd(200));
    await subscribe(ALICE, "https://push.example/1");
    await subscribe(BOB, "https://push.example/bob"); // someone else's browser is never notified

    const sent: string[] = [];
    const push: PushSender = async (target, payload) => {
      sent.push(`${target.endpoint} ${JSON.parse(payload).title}`);
      return "sent";
    };
    const results = await Promise.all([evaluateAlerts(sql, push, config, quiet), evaluateAlerts(sql, push, config, quiet)]);
    assert.equal(results[0] + results[1], 1, "exactly one runner claims the alert");
    assert.deepEqual(sent, ["https://push.example/1 NVDA at or above $200.00"]);

    const [stored] = await sql`select status, trigger_price, triggered_at from price_alerts where id = ${id}`;
    assert.equal(stored?.status, "triggered");
    assert.equal(stored?.trigger_price, usd(201));
    assert.ok(stored?.triggered_at);
    const notes = await sql`select wallet, alert_id, title, body, symbol from notifications`;
    assert.deepEqual(notes.map((n) => ({ ...n })), [{ wallet: ALICE, alert_id: id, title: "NVDA at or above $200.00", body: "Now $201.00.", symbol: "NVDA" }]);

    assert.equal(await evaluateAlerts(sql, push, config, quiet), 0);
    assert.equal(sent.length, 1, "a second pass sends nothing");
    assert.equal(await count("notifications"), 1);
  });

  test("three runners racing over thirty crossed alerts fire each exactly once", async () => {
    await reset();
    await market("NVDA");
    await tick("NVDA", usd(500));
    for (let n = 1; n <= 30; n++) await alert(ALICE, "NVDA", "price_above", usd(100 + n));
    await subscribe(ALICE, "https://push.example/1");
    const sent: string[] = [];
    const push: PushSender = async (_target, payload) => (sent.push(JSON.parse(payload).tag), "sent");
    const fired = await Promise.all([1, 2, 3].map(() => evaluateAlerts(sql, push, config, quiet)));
    assert.equal(fired.reduce((a, b) => a + b, 0), 30);
    assert.equal(sent.length, 30);
    assert.equal(new Set(sent).size, 30, "no alert was pushed twice");
    assert.equal(await count("notifications"), 30);
  });

  test("a second notification for the same alert is impossible even if a claim were bypassed", async () => {
    await reset();
    await market("NVDA");
    const id = await alert(ALICE, "NVDA", "price_above", usd(200));
    await sql`insert into notifications (wallet, alert_id, title, body, symbol) values (${ALICE}, ${id}, 't', 'b', 'NVDA')`;
    await assert.rejects(sql`insert into notifications (wallet, alert_id, title, body, symbol) values (${ALICE}, ${id}, 't', 'b', 'NVDA')`);
  });

  test("an alert waits while the price has not crossed, is stale, the market is paused, or there is no price", async () => {
    await reset();
    await market("NVDA");
    await market("AMD");
    await market("TSLA", false);
    await market("META");
    await tick("NVDA", usd(199)); // below the level
    await tick("AMD", usd(250), 3_600_000); // crossed, but the last price is an hour old: the session is closed
    await tick("TSLA", usd(250)); // crossed, but the market is paused
    // META has no price at all
    for (const symbol of ["NVDA", "AMD", "TSLA", "META"]) await alert(ALICE, symbol, "price_above", usd(200));
    await alert(ALICE, "ZZZZ", "price_above", usd(1)); // not a listed market

    const push: PushSender = async () => assert.fail("nothing should be sent");
    assert.equal(await evaluateAlerts(sql, push, config, quiet), 0);
    assert.equal((await sql`select id from price_alerts where status = 'active'`).length, 5);
    assert.equal(await count("notifications"), 0);

    // A fresh price on the stale market releases its alert.
    await tick("AMD", usd(251));
    const sent: string[] = [];
    assert.equal(await evaluateAlerts(sql, async (_t, payload) => (sent.push(JSON.parse(payload).title), "sent"), config, quiet), 1);
    assert.deepEqual(sent, []); // no subscription, so no push; the in-app notification is still written
    assert.equal(await count("notifications"), 1);
  });

  test("a percent alert is measured from the price at creation, and a fall fires below", async () => {
    await reset();
    await market("NVDA");
    await tick("NVDA", usd(180));
    await alert(ALICE, "NVDA", "pct_down", "500", usd(190)); // 5% below 190 is 180.50
    await alert(ALICE, "NVDA", "pct_up", "500", usd(190)); // 5% above 190 is 199.50
    assert.equal(await evaluateAlerts(sql, undefined, config, quiet), 1);
    const [row] = await sql`select kind from price_alerts where status = 'triggered'`;
    assert.equal(row?.kind, "pct_down");
  });

  test("an expired subscription (gone) is deleted and a failing one is kept", async () => {
    await reset();
    await market("NVDA");
    await tick("NVDA", usd(201));
    await alert(ALICE, "NVDA", "price_above", usd(200));
    await subscribe(ALICE, "https://push.example/dead");
    await subscribe(ALICE, "https://push.example/flaky");
    await subscribe(ALICE, "https://push.example/ok");
    const push: PushSender = async (target) => (target.endpoint.endsWith("dead") ? "gone" : target.endpoint.endsWith("flaky") ? "failed" : "sent");
    assert.equal(await evaluateAlerts(sql, push, config, quiet), 1);
    const left = (await sql<{ endpoint: string }[]>`select endpoint from push_subscriptions order by endpoint`).map((r) => r.endpoint);
    assert.deepEqual(left, ["https://push.example/flaky", "https://push.example/ok"]);
  });

  test("old notifications and finished alerts are pruned, active alerts never", async () => {
    await reset();
    await market("NVDA");
    const old = await alert(ALICE, "NVDA", "price_above", usd(200));
    await alert(ALICE, "NVDA", "price_above", usd(300)); // still active
    await sql`update price_alerts set status = 'triggered', triggered_at = now() - interval '40 days' where id = ${old}`;
    await sql`insert into notifications (wallet, alert_id, title, body, symbol, created_at) values (${ALICE}, ${old}, 't', 'b', 'NVDA', now() - interval '40 days')`;
    await evaluateAlerts(sql, undefined, config, quiet);
    assert.equal(await count("notifications"), 0);
    assert.deepEqual((await sql`select status from price_alerts`).map((r) => r.status), ["active"]);
  });

  test("done", async () => {
    await sql.end();
  });
});
