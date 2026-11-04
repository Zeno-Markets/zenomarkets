/// Price alert requests: parsing, the signature and window rules, and the refusals that never reach the database run
/// without one. The stored behaviour (cap, replay, ownership, subscriptions) runs against PostgreSQL when
/// TEST_DATABASE_URL is set; the tables are emptied first, so point it at a scratch database.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { alertMessage, MAX_ACTIVE_ALERTS, resolveMarketId, type AlertRequest } from "@zeno/sdk";
import Fastify from "fastify";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { parseCancel, parseCreate, parseSubscribe, withinWindow } from "./alerts.js";
import { registerAlertRoutes } from "./routes/alerts.js";

const url = process.env.TEST_DATABASE_URL;
const alice = privateKeyToAccount(`0x${"11".repeat(32)}`);
const mallory = privateKeyToAccount(`0x${"22".repeat(32)}`);
const now = () => Math.floor(Date.now() / 1000);
const usd = (n: number) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString();
const FCM = "https://fcm.googleapis.com/fcm/send/abcdef";
const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

type Account = typeof alice;
async function post(app: ReturnType<typeof Fastify>, path: string, account: Account, request: AlertRequest, issuedAt = now(), wallet = account.address) {
  const signature = await account.signMessage({ message: alertMessage(wallet, request, issuedAt) });
  const { action: _action, ...fields } = request;
  return app.inject({ method: "POST", url: path, payload: { wallet, issuedAt, signature, ...fields } as never });
}
const create = (value: string, kind: "price_above" | "price_below" | "pct_up" | "pct_down" = "price_above", symbol = "NVDA"): AlertRequest => ({ action: "create", symbol, kind, value });

test("a request body is checked before anything else", () => {
  const ok = { wallet: alice.address, issuedAt: now(), signature: "0x01" };
  assert.ok(!("error" in parseCreate({ ...ok, symbol: "NVDA", kind: "pct_up", value: "5" })));
  assert.match((parseCreate({ ...ok, symbol: "nvda", kind: "pct_up", value: "5" }) as { error: string }).error, /symbol/);
  assert.match((parseCreate({ ...ok, symbol: "NVDA", kind: "moon", value: "5" }) as { error: string }).error, /kind/);
  assert.match((parseCreate({ ...ok, symbol: "NVDA", kind: "pct_up", value: 5 }) as { error: string }).error, /value/);
  assert.match((parseCreate({ ...ok, wallet: "nope", symbol: "NVDA", kind: "pct_up", value: "5" }) as { error: string }).error, /wallet/);
  assert.match((parseCancel({ ...ok, id: 0 }) as { error: string }).error, /id/);
  assert.ok(!("error" in parseCancel({ ...ok, id: 4 })));
});

test("only the push services browsers use are accepted, over https", () => {
  const ok = { wallet: alice.address, issuedAt: now(), signature: "0x01", p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" };
  for (const endpoint of [FCM, "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc"]) {
    assert.ok(!("error" in parseSubscribe({ ...ok, endpoint })), endpoint);
  }
  for (const endpoint of ["http://fcm.googleapis.com/fcm/send/a", "https://internal.railway.app/hook", "https://fcm.googleapis.com.evil.com/x", "https://localhost:8443/x", "https://fcm.googleapis.com:8443/x", "javascript:alert(1)", "nope"]) {
    assert.ok("error" in parseSubscribe({ ...ok, endpoint }), endpoint);
  }
  assert.match((parseSubscribe({ ...ok, endpoint: FCM, auth: "!!" }) as { error: string }).error, /keys/);
});

test("the window is ten minutes either side", () => {
  assert.ok(withinWindow(now()) && withinWindow(now() - 599) && withinWindow(now() + 599));
  assert.ok(!withinWindow(now() - 601) && !withinWindow(now() + 601));
});

test("a bad body, a stale time and a signature from the wrong key are refused before the database is asked", async () => {
  const queries: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => (queries.push(strings.join("?")), [])) as never;
  const app = Fastify();
  registerAlertRoutes(app, sql);

  assert.equal((await app.inject({ method: "POST", url: "/v1/alerts", payload: { wallet: "nope" } as never })).statusCode, 400);
  assert.equal((await post(app, "/v1/alerts", alice, create("200"), now() - 3_600)).statusCode, 400);
  assert.equal((await post(app, "/v1/alerts", mallory, create("200"), now(), alice.address)).statusCode, 401, "signed by someone else");
  // A signature for one alert does not carry to another.
  const signature = await alice.signMessage({ message: alertMessage(alice.address, create("200"), now()) });
  const swapped = await app.inject({ method: "POST", url: "/v1/alerts", payload: { wallet: alice.address, issuedAt: now(), signature, symbol: "NVDA", kind: "price_above", value: "1" } });
  assert.equal(swapped.statusCode, 401);
  assert.equal((await post(app, "/v1/alerts/cancel", mallory, { action: "cancel", id: 1 }, now(), alice.address)).statusCode, 401);
  assert.equal((await post(app, "/v1/push/subscribe", mallory, { action: "subscribe", endpoint: FCM, p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" }, now(), alice.address)).statusCode, 401);
  assert.equal((await app.inject({ url: "/v1/alerts/nope" })).statusCode, 400);
  assert.equal((await app.inject({ url: "/v1/notifications/nope" })).statusCode, 400);
  assert.equal(queries.length, 0, "nothing is read or written for a refused request");
});

describe("price alert routes against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  const sql = postgres(url ?? "postgres://unused", { transform: postgres.camel });
  const app = Fastify();
  const NVDA = resolveMarketId("NVDA");
  const count = async (status = "active") => Number((await sql`select count(*)::int as n from price_alerts where status = ${status}`)[0]?.n);

  before(async () => {
    registerAlertRoutes(app, sql);
    await app.ready();
  });
  after(async () => {
    await sql.end();
    await app.close();
  });
  async function reset(active = true, price: string | null = usd(190)) {
    await sql`truncate price_alerts, notifications, push_subscriptions, price_ticks, markets restart identity`;
    await sql`insert into markets (market_id, underlying_token, oracle_id, options_enabled, perps_enabled, max_leverage, open_interest_cap, active, block_number)
      values (${NVDA}, '0x1', '0x2', false, true, '10', '0', ${active}, 1)`;
    if (price) await sql`insert into price_ticks (market_id, price) values (${NVDA}, ${price})`;
  }

  test("an alert is stored with the price at creation, and the same signed request cannot be replayed", async () => {
    await reset();
    const issuedAt = now();
    const first = await post(app, "/v1/alerts", alice, create("200"), issuedAt);
    assert.equal(first.statusCode, 200, first.body);
    const [row] = await sql`select wallet, symbol, kind, target, base_price from price_alerts`;
    assert.deepEqual({ ...row }, { wallet: alice.address.toLowerCase(), symbol: "NVDA", kind: "price_above", target: usd(200), basePrice: usd(190) });

    const replay = await post(app, "/v1/alerts", alice, create("200"), issuedAt);
    assert.equal(replay.statusCode, 409);
    assert.match(replay.json().error, /already accepted/);
    assert.equal(await count(), 1);
  });

  test("a level the price has already passed, an unknown market and a market with no price are refused", async () => {
    await reset();
    assert.equal((await post(app, "/v1/alerts", alice, create("150"), now())).statusCode, 409); // 'above 150' with the price at 190
    assert.equal((await post(app, "/v1/alerts", alice, create("250", "price_below"), now() - 1)).statusCode, 409);
    assert.equal((await post(app, "/v1/alerts", alice, create("5", "pct_up", "ZZZZ"), now() - 2)).statusCode, 404);
    assert.equal((await post(app, "/v1/alerts", alice, create("abc"), now() - 3)).statusCode, 400);
    await reset(true, null);
    const quiet = await post(app, "/v1/alerts", alice, create("200"), now());
    assert.equal(quiet.statusCode, 409);
    assert.match(quiet.json().error, /no price yet/);
    assert.equal(await count(), 0);
  });

  test("a wallet holds at most the capped number of active alerts, and a cancelled one frees a place", async () => {
    await reset();
    for (let n = 0; n < MAX_ACTIVE_ALERTS; n++) assert.equal((await post(app, "/v1/alerts", alice, create(String(200 + n)), now() - n)).statusCode, 200, `alert ${n}`);
    const over = await post(app, "/v1/alerts", alice, create("400"), now() - 100);
    assert.equal(over.statusCode, 409);
    assert.match(over.json().error, new RegExp(`${MAX_ACTIVE_ALERTS} active alerts`));
    assert.equal(await count(), MAX_ACTIVE_ALERTS);
    // The cap is per wallet.
    assert.equal((await post(app, "/v1/alerts", mallory, create("200"), now())).statusCode, 200);

    assert.equal((await post(app, "/v1/alerts/cancel", alice, { action: "cancel", id: 1 }, now())).statusCode, 200);
    assert.equal((await post(app, "/v1/alerts", alice, create("400"), now() - 101)).statusCode, 200);
  });

  test("only the owner cancels an active alert, once", async () => {
    await reset();
    await post(app, "/v1/alerts", alice, create("200"), now());
    const theirs = await post(app, "/v1/alerts/cancel", mallory, { action: "cancel", id: 1 }, now());
    assert.equal(theirs.statusCode, 404);
    assert.equal(await count(), 1, "another wallet cannot cancel it");
    assert.equal((await post(app, "/v1/alerts/cancel", alice, { action: "cancel", id: 1 }, now())).statusCode, 200);
    assert.equal((await post(app, "/v1/alerts/cancel", alice, { action: "cancel", id: 1 }, now())).statusCode, 404, "a repeat finds nothing to cancel");
    assert.equal(await count("cancelled"), 1);
  });

  test("the list shows active and triggered alerts, marks a paused market, and notifications come newest first", async () => {
    await reset();
    await post(app, "/v1/alerts", alice, create("200"), now());
    await post(app, "/v1/alerts", alice, create("5", "pct_down"), now() - 1);
    await sql`update price_alerts set status = 'triggered', trigger_price = ${usd(180)}, triggered_at = now() where id = 2`;
    await post(app, "/v1/alerts", alice, create("210"), now() - 2);
    await post(app, "/v1/alerts/cancel", alice, { action: "cancel", id: 3 }, now());
    let body = (await app.inject({ url: `/v1/alerts/${alice.address.toUpperCase().replace("0X", "0x")}` })).json();
    assert.equal(body.maxActive, MAX_ACTIVE_ALERTS);
    assert.deepEqual(body.alerts.map((a: { id: number; status: string; paused: boolean }) => [a.id, a.status, a.paused]), [[2, "triggered", false], [1, "active", false]]);
    assert.equal(body.alerts[0].triggerPrice, usd(180));
    assert.equal(body.alerts[1].basePrice, usd(190));

    await sql`update markets set active = false`;
    body = (await app.inject({ url: `/v1/alerts/${alice.address}` })).json();
    assert.deepEqual(body.alerts.map((a: { paused: boolean }) => a.paused), [true, true]);

    await sql`insert into notifications (wallet, alert_id, title, body, symbol) values (${alice.address.toLowerCase()}, 1, 'first', 'b', 'NVDA'), (${alice.address.toLowerCase()}, 2, 'second', 'b', 'NVDA'), (${mallory.address.toLowerCase()}, 9, 'not yours', 'b', 'NVDA')`;
    const notes = (await app.inject({ url: `/v1/notifications/${alice.address}` })).json().notifications;
    assert.deepEqual(notes.map((n: { title: string }) => n.title), ["second", "first"]);
  });

  test("a browser is registered only with the wallet's signature, and a wallet keeps its newest five", async () => {
    await reset();
    const subscribe = (n: number, account: Account = alice, issuedAt = now()) =>
      post(app, "/v1/push/subscribe", account, { action: "subscribe", endpoint: `https://fcm.googleapis.com/fcm/send/dev${n}`, p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" }, issuedAt);
    assert.equal((await subscribe(1)).statusCode, 200);
    assert.equal((await subscribe(1)).statusCode, 200, "registering the same browser again is harmless");
    for (let n = 2; n <= 6; n++) {
      await subscribe(n);
      await sql`update push_subscriptions set created_at = now() + ${n} * interval '1 second' where endpoint like ${"%dev" + n}`;
    }
    await subscribe(7, alice, now() - 1);
    const rows = await sql`select endpoint from push_subscriptions where wallet = ${alice.address.toLowerCase()}`;
    assert.equal(rows.length, 5);
    assert.ok(!rows.some((r) => String(r.endpoint).endsWith("dev1")), "the oldest browser was dropped");
  });
});
