import { alertFires, notificationText, resolveMarketId, type AlertKind } from "@zeno/sdk";
import type postgres from "postgres";
import webpush from "web-push";

type Sql = ReturnType<typeof postgres>;

/// The server side of smart price alerts. It reads only what the indexer already records (`price_ticks`, `markets`)
/// and the alerts the API stored, so it needs no RPC and no per-user connection: one query for the open alerts, one
/// for the latest price of the markets they name. A hit is claimed with a conditional UPDATE and its notification is
/// written in the same transaction, which is what makes "exactly once" hold even with two runners at the same time.

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
/// `gone` means the push service said the browser is unsubscribed (HTTP 404 or 410): the subscription is deleted.
export type PushSender = (target: PushTarget, payload: string) => Promise<"sent" | "gone" | "failed">;

export interface AlertConfig {
  /// A market whose latest sampled price is older than this is treated as closed or stale: its alerts wait.
  maxPriceAgeMs: number;
  /// Notifications, and alerts that are no longer active, older than this are deleted.
  retentionDays: number;
}

export function webPushSender(vapid: { subject: string; publicKey: string; privateKey: string }): PushSender {
  return async (target, payload) => {
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        vapidDetails: vapid,
        TTL: 3600,
        timeout: 10_000,
      });
      return "sent";
    } catch (error) {
      const { statusCode, message } = error as { statusCode?: number; message?: string };
      if (statusCode === 404 || statusCode === 410) return "gone";
      // One short line, never the subscription: the endpoint is the browser's private address.
      console.warn(`indexer: web push not delivered: ${statusCode ?? String(message).slice(0, 100)}`);
      return "failed";
    }
  };
}

interface AlertRow {
  id: number;
  wallet: string;
  symbol: string;
  kind: AlertKind;
  target: string;
  base_price: string;
}

/// One pass. Returns how many alerts it fired.
export async function evaluateAlerts(sql: Sql, push: PushSender | undefined, config: AlertConfig, log: (message: string) => void = console.log, nowMs = Date.now()): Promise<number> {
  const open = await sql<AlertRow[]>`select id, wallet, symbol, kind, target, base_price from price_alerts where status = 'active' order by id`;
  let fired = 0;

  if (open.length > 0) {
    const marketIds = [...new Set(open.map((alert) => resolveMarketId(alert.symbol)))];
    const rows = await sql<{ market_id: string; price: string; sampled_at: Date; active: boolean }[]>`
      select distinct on (t.market_id) t.market_id, t.price, t.sampled_at, m.active
      from price_ticks t join markets m on m.market_id = t.market_id
      where t.market_id in ${sql(marketIds)}
      order by t.market_id, t.sampled_at desc
    `;
    const latest = new Map(rows.map((row) => [row.market_id, row]));

    for (const alert of open) {
      const tick = latest.get(resolveMarketId(alert.symbol));
      // No price, a paused market, or a price too old to trust (the market is closed): the alert keeps waiting.
      if (!tick || !tick.active || nowMs - new Date(tick.sampled_at).getTime() > config.maxPriceAgeMs) continue;
      const price = BigInt(tick.price);
      if (!alertFires({ kind: alert.kind, target: alert.target, basePrice: alert.base_price }, price)) continue;

      const message = notificationText({ symbol: alert.symbol, kind: alert.kind, target: alert.target, basePrice: alert.base_price }, price);
      // Claim first. Only the runner whose UPDATE matches a row still `active` goes on to notify.
      const claimed = await sql.begin(async (tx) => {
        const [row] = await tx`
          update price_alerts set status = 'triggered', trigger_price = ${price.toString()}, triggered_at = now()
          where id = ${alert.id} and status = 'active' returning id
        `;
        if (!row) return false;
        await tx`insert into notifications (wallet, alert_id, title, body, symbol) values (${alert.wallet}, ${alert.id}, ${message.title}, ${message.body}, ${alert.symbol})`;
        return true;
      });
      if (!claimed) continue;
      fired += 1;
      log(`indexer: alert ${alert.id} fired for ${alert.symbol}`);
      if (push) await sendPush(sql, push, alert, message, log);
    }
  }

  await sql`delete from notifications where created_at < now() - make_interval(days => ${config.retentionDays})`;
  await sql`delete from price_alerts where status <> 'active' and coalesce(triggered_at, created_at) < now() - make_interval(days => ${config.retentionDays})`;
  return fired;
}

async function sendPush(sql: Sql, push: PushSender, alert: AlertRow, message: { title: string; body: string }, log: (message: string) => void) {
  const targets = await sql<PushTarget[]>`select endpoint, p256dh, auth from push_subscriptions where wallet = ${alert.wallet}`;
  const payload = JSON.stringify({ title: message.title, body: message.body, url: "/alerts", tag: `alert-${alert.id}` });
  for (const target of targets) {
    const result = await push(target, payload).catch(() => "failed" as const);
    if (result === "gone") await sql`delete from push_subscriptions where endpoint = ${target.endpoint}`;
    if (result !== "sent") log(`indexer: push for alert ${alert.id} ${result === "gone" ? "removed an expired subscription" : "failed"}`);
  }
}
