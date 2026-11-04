import type { Zeno } from "@zeno/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";
import { COPY_WINDOW_SECONDS, followMessage, parseFollowBody, parseUnfollowBody, signedBy, unfollowMessage, withinWindow } from "../copy.js";
import { ADDRESS } from "../leaderboard.js";

type Sql = ReturnType<typeof getSql>;

/// Copy trading: follow, stop, and what the executor did. A follow is a signed instruction (see `../copy.ts`);
/// the API checks on chain that the follower owns the copy subaccount, and records which of the leader's
/// positions are already open so the executor never copies a position that predates the follow. The executor
/// itself runs in `services/keeper`. `COPY_EXECUTOR_ADDRESS` is the address the follower makes a delegate.
export function registerCopyRoutes(app: FastifyInstance, zeno: Zeno, sql: Sql = getSql(), executor = process.env.COPY_EXECUTOR_ADDRESS) {
  app.get("/v1/copy/config", async () => ({ executor: executor && ADDRESS.test(executor) ? executor.toLowerCase() : null, signatureWindowSeconds: COPY_WINDOW_SECONDS }));

  app.post<{ Body: unknown }>("/v1/copy/follows", async (request, reply) => {
    const parsed = parseFollowBody(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });
    if (!withinWindow(parsed.issuedAt)) return reply.code(400).send({ error: `issuedAt must be within ${COPY_WINDOW_SECONDS / 60} minutes of now` });
    if (!(await signedBy(parsed.follower, followMessage(parsed), parsed.signature))) return reply.code(401).send({ error: "signature does not match the follower" });

    let owned: boolean;
    let leaderOpen: Awaited<ReturnType<Zeno["portfolio"]["positions"]>>["perps"];
    try {
      owned = (await zeno.subaccounts.list(parsed.follower as `0x${string}`)).some((s) => s.address.toLowerCase() === parsed.subaccount);
      leaderOpen = (await zeno.portfolio.positions(parsed.leader as `0x${string}`)).perps.filter((p) => p.open);
    } catch (error) {
      request.log.error({ err: error }, "copy: chain read failed");
      return reply.code(502).send({ error: "chain unavailable" });
    }
    if (!owned) return reply.code(400).send({ error: "the follower does not own that copy subaccount" });

    const saved = await sql.begin(async (tx) => {
      const rows = await tx`
        insert into copy_follows (follower, leader, subaccount, max_trade_size, max_exposure, max_leverage, markets, active, issued_at)
        values (${parsed.follower}, ${parsed.leader}, ${parsed.subaccount}, ${parsed.maxTradeSize}, ${parsed.maxExposure}, ${parsed.maxLeverage},
                ${parsed.markets === null ? null : tx.json(parsed.markets)}, true, ${parsed.issuedAt})
        on conflict (follower, leader) do update
          set subaccount = excluded.subaccount, max_trade_size = excluded.max_trade_size, max_exposure = excluded.max_exposure,
              max_leverage = excluded.max_leverage, markets = excluded.markets, active = true, issued_at = excluded.issued_at, updated_at = now()
          where copy_follows.issued_at < excluded.issued_at
        returning id, (xmax = 0) as inserted
      `;
      const row = rows[0];
      if (!row) return undefined;
      // Positions the leader already holds are never copied. Only on a fresh follow or a restart after a stop.
      for (const p of leaderOpen) {
        await tx`
          insert into copy_executions (follow_id, leader_position_id, status, reason, market, is_long, leader_size)
          values (${row.id}, ${p.positionId.toString()}, 'existing', 'The leader opened this before you followed.', ${Buffer.from(p.marketId.slice(2), "hex").toString("utf8").replace(/\0+$/, "")}, ${p.isLong}, ${p.size.toString()})
          on conflict (follow_id, leader_position_id) do nothing
        `;
      }
      return row.id as number;
    });
    if (saved === undefined) return reply.code(409).send({ error: "a newer change to this follow was already accepted" });
    return { id: saved, follower: parsed.follower, leader: parsed.leader, active: true };
  });

  app.post<{ Body: unknown }>("/v1/copy/unfollow", async (request, reply) => {
    const parsed = parseUnfollowBody(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });
    if (!withinWindow(parsed.issuedAt)) return reply.code(400).send({ error: `issuedAt must be within ${COPY_WINDOW_SECONDS / 60} minutes of now` });
    if (!(await signedBy(parsed.follower, unfollowMessage(parsed), parsed.signature))) return reply.code(401).send({ error: "signature does not match the follower" });
    const stopped = await sql`
      update copy_follows set active = false, issued_at = ${parsed.issuedAt}, updated_at = now()
      where follower = ${parsed.follower} and leader = ${parsed.leader} and issued_at < ${parsed.issuedAt}
      returning id
    `;
    if (stopped.length === 0) return reply.code(404).send({ error: "no follow to stop, or a newer change was already accepted" });
    return { follower: parsed.follower, leader: parsed.leader, active: false };
  });

  /// A follower's follows with their caps, and the last executions (mirrored trades and skips, with the reason).
  app.get<{ Querystring: { follower?: string } }>("/v1/copy/follows", async (request, reply) => {
    const follower = request.query.follower;
    if (!follower || !ADDRESS.test(follower)) return reply.code(400).send({ error: "follower must be an address" });
    const follows = await sql`
      select id, follower, leader, subaccount, max_trade_size, max_exposure, max_leverage, markets, active, created_at
      from copy_follows where follower = ${follower.toLowerCase()} order by id desc
    `;
    const ids = follows.map((f) => f.id as number);
    const executions = ids.length === 0 ? [] : await sql`
      select follow_id, leader_position_id, follower_position_id, status, reason, market, is_long, leader_size, follower_size, updated_at
      from copy_executions where follow_id in ${sql(ids)} and status <> 'existing' order by updated_at desc limit 50
    `;
    return { follows, executions };
  });

  app.get<{ Params: { leader: string } }>("/v1/copy/followers/:leader", async (request, reply) => {
    if (!ADDRESS.test(request.params.leader)) return reply.code(400).send({ error: "leader must be an address" });
    const [row] = await sql`select count(*)::int as count from copy_follows where leader = ${request.params.leader.toLowerCase()} and active`;
    return { leader: request.params.leader.toLowerCase(), followers: row?.count ?? 0 };
  });
}
