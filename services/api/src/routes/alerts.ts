import { alertFires, alertMessage, MAX_ACTIVE_ALERTS, parseAlertValue, resolveMarketId, ALERT_WINDOW_SECONDS } from "@zeno/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";
import { MAX_DEVICES, parseCancel, parseCreate, parseSubscribe, withinWindow } from "../alerts.js";
import { signedBy } from "../copy.js";
import { ADDRESS } from "../leaderboard.js";

type Sql = ReturnType<typeof getSql>;

const lateMessage = `issuedAt must be within ${ALERT_WINDOW_SECONDS / 60} minutes of now`;

/// Smart price alerts. Writes are signed (EIP-191, see `alertMessage` in `@zeno/sdk`): the wallet proves it made the
/// request, inside a ten-minute window, and `(wallet, issued_at)` is unique so a captured request cannot be replayed.
/// Reads are public GETs keyed by wallet, like the portfolio: anyone who knows an address can read that wallet's
/// alerts and notifications. They name a market and a price level, never a balance or a position. Firing the
/// alerts is `services/indexer`'s job; this service only stores them.
export function registerAlertRoutes(app: FastifyInstance, sql: Sql = getSql()) {
  /// A wallet's active alerts, and its last triggered ones. `paused` is true while the alert's market is paused, so
  /// the page can say why it is not firing.
  app.get<{ Params: { wallet: string } }>("/v1/alerts/:wallet", async (request, reply) => {
    if (!ADDRESS.test(request.params.wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    const wallet = request.params.wallet.toLowerCase();
    const rows = await sql<{ symbol: string }[]>`
      select id, symbol, kind, target, base_price, status, trigger_price, created_at, triggered_at
      from price_alerts where wallet = ${wallet} and status in ('active', 'triggered') order by id desc limit 100
    `;
    const ids = [...new Set(rows.map((row) => resolveMarketId(row.symbol)))];
    const pausedRows = ids.length === 0 ? [] : await sql<{ marketId: string }[]>`select market_id from markets where active = false and market_id in ${sql(ids)}`;
    const paused = new Set(pausedRows.map((row) => row.marketId));
    const alerts = rows.map((row) => ({ ...row, paused: paused.has(resolveMarketId(row.symbol)) }));
    return { maxActive: MAX_ACTIVE_ALERTS, alerts };
  });

  app.get<{ Params: { wallet: string } }>("/v1/notifications/:wallet", async (request, reply) => {
    if (!ADDRESS.test(request.params.wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    const notifications = await sql`
      select id, alert_id, title, body, symbol, created_at from notifications
      where wallet = ${request.params.wallet.toLowerCase()} order by id desc limit 30
    `;
    return { notifications };
  });

  app.post<{ Body: unknown }>("/v1/alerts", async (request, reply) => {
    const body = parseCreate(request.body);
    if ("error" in body) return reply.code(400).send({ error: body.error });
    if (!withinWindow(body.issuedAt)) return reply.code(400).send({ error: lateMessage });
    if (!(await signedBy(body.wallet, alertMessage(body.wallet, body, body.issuedAt), body.signature))) return reply.code(401).send({ error: "signature does not match the wallet" });

    const parsed = parseAlertValue(body.kind, body.value);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

    const marketId = resolveMarketId(body.symbol);
    const [market] = await sql`select active from markets where market_id = ${marketId}`;
    if (!market) return reply.code(404).send({ error: `no market found for ${body.symbol}` });
    const [tick] = await sql<{ price: string }[]>`select price from price_ticks where market_id = ${marketId} order by sampled_at desc limit 1`;
    if (!tick) return reply.code(409).send({ error: `${body.symbol} has no price yet, so an alert cannot be set` });
    if (alertFires({ kind: body.kind, target: parsed.target, basePrice: tick.price }, BigInt(tick.price))) {
      return reply.code(409).send({ error: "The price is already past that level. Pick a level the price has not reached." });
    }

    // One statement counts and inserts, so the cap holds without a lock. A repeated (wallet, issued_at) inserts nothing.
    const saved = await sql`
      insert into price_alerts (wallet, symbol, kind, target, base_price, issued_at)
      select ${body.wallet}, ${body.symbol}, ${body.kind}, ${parsed.target}, ${tick.price}, ${body.issuedAt}
      where (select count(*) from price_alerts where wallet = ${body.wallet} and status = 'active') < ${MAX_ACTIVE_ALERTS}
      on conflict (wallet, issued_at) do nothing
      returning id
    `;
    if (saved.length === 0) {
      const [{ count } = { count: 0 }] = await sql<{ count: number }[]>`select count(*)::int as count from price_alerts where wallet = ${body.wallet} and status = 'active'`;
      return reply.code(409).send({ error: count >= MAX_ACTIVE_ALERTS ? `You can have ${MAX_ACTIVE_ALERTS} active alerts. Cancel one first.` : "That request was already accepted." });
    }
    return { id: saved[0]?.id, symbol: body.symbol, kind: body.kind, target: parsed.target, basePrice: tick.price };
  });

  app.post<{ Body: unknown }>("/v1/alerts/cancel", async (request, reply) => {
    const body = parseCancel(request.body);
    if ("error" in body) return reply.code(400).send({ error: body.error });
    if (!withinWindow(body.issuedAt)) return reply.code(400).send({ error: lateMessage });
    if (!(await signedBy(body.wallet, alertMessage(body.wallet, body, body.issuedAt), body.signature))) return reply.code(401).send({ error: "signature does not match the wallet" });
    // Only the owner's own active alert: another wallet's id, or one that already fired, matches nothing.
    const cancelled = await sql`update price_alerts set status = 'cancelled' where id = ${body.id} and wallet = ${body.wallet} and status = 'active' returning id`;
    if (cancelled.length === 0) return reply.code(404).send({ error: "No active alert with that number. It may have already fired." });
    return { id: body.id, status: "cancelled" };
  });

  /// Registers this browser for Web Push. Signed like the rest, so nobody can point their browser at another
  /// wallet's alerts. A wallet keeps its newest `MAX_DEVICES` browsers.
  app.post<{ Body: unknown }>("/v1/push/subscribe", async (request, reply) => {
    const body = parseSubscribe(request.body);
    if ("error" in body) return reply.code(400).send({ error: body.error });
    if (!withinWindow(body.issuedAt)) return reply.code(400).send({ error: lateMessage });
    if (!(await signedBy(body.wallet, alertMessage(body.wallet, body, body.issuedAt), body.signature))) return reply.code(401).send({ error: "signature does not match the wallet" });
    await sql`
      insert into push_subscriptions (endpoint, wallet, p256dh, auth) values (${body.endpoint}, ${body.wallet}, ${body.p256dh}, ${body.auth})
      on conflict (endpoint) do update set wallet = excluded.wallet, p256dh = excluded.p256dh, auth = excluded.auth
    `;
    await sql`
      delete from push_subscriptions where wallet = ${body.wallet} and endpoint not in
        (select endpoint from push_subscriptions where wallet = ${body.wallet} order by created_at desc, endpoint limit ${MAX_DEVICES})
    `;
    return { ok: true };
  });
}
