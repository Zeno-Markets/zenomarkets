import assert from "node:assert/strict";
import { test } from "node:test";
import type { Zeno } from "@zeno/sdk";
import Fastify from "fastify";
import { privateKeyToAccount } from "viem/accounts";
import { visibilityMessage } from "./leaderboard.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";

/// The routes' refusals and the synthetic board, which never reach the database. The ranking SQL itself is
/// covered by `leaderboard.integration.test.ts` against a real PostgreSQL.
const zeno = { addresses: { settlementToken: `0x${"aa".repeat(20)}` }, erc20: { decimals: async () => 6 } } as unknown as Zeno;

function build() {
  const queries: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return [];
  }) as never;
  const app = Fastify();
  registerLeaderboardRoutes(app, zeno, sql, undefined);
  return { app, queries };
}

test("a bad leaderboard query is refused before the database is asked", async () => {
  const { app, queries } = build();
  for (const query of ["metric=sharpe", "window=24h", "limit=500", "offset=-3", "sample=0"]) {
    const response = await app.inject({ url: `/v1/leaderboard?${query}` });
    assert.equal(response.statusCode, 400, query);
    assert.equal(typeof response.json().error, "string");
  }
  assert.equal(queries.length, 0);
});

test("the sample board with no simulator wallets is the synthetic board, without a database read", async () => {
  const { app, queries } = build();
  const response = await app.inject({ url: "/v1/leaderboard?sample=1&metric=volume&limit=3" });
  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.sample, true);
  assert.equal(json.entries.length, 3);
  assert.equal(json.settlementDecimals, 6);
  assert.equal(json.metric, "volume");
  assert.equal(queries.length, 0);
});

test("an empty real board is a 200 with no entries", async () => {
  const { app } = build();
  const response = await app.inject({ url: "/v1/leaderboard" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().entries, []);
  assert.equal(response.json().total, 0);
  assert.equal(response.json().sample, false);
});

test("a visibility change is refused for a bad body, a stale time, and a signature from the wrong key", async () => {
  const { app, queries } = build();
  const account = privateKeyToAccount(`0x${"55".repeat(32)}`);
  const wallet = account.address.toLowerCase();
  const post = (payload: unknown) => app.inject({ method: "POST", url: "/v1/leaderboard/visibility", payload: payload as never });

  assert.equal((await post({ wallet: "nope" })).statusCode, 400);

  const stale = Math.floor(Date.now() / 1000) - 3_600;
  const staleSignature = await account.signMessage({ message: visibilityMessage(wallet, true, stale) });
  assert.equal((await post({ wallet, hidden: true, issuedAt: stale, signature: staleSignature })).statusCode, 400);

  const now = Math.floor(Date.now() / 1000);
  const other = privateKeyToAccount(`0x${"66".repeat(32)}`);
  const forged = await other.signMessage({ message: visibilityMessage(wallet, true, now) });
  assert.equal((await post({ wallet, hidden: true, issuedAt: now, signature: forged })).statusCode, 401);
  assert.equal(queries.length, 0, "nothing is written for a refused change");
});

test("a PNL card path is validated before the database is asked", async () => {
  const { app, queries } = build();
  assert.equal((await app.inject({ url: "/v1/pnl-card/nope/1" })).statusCode, 400);
  assert.equal((await app.inject({ url: `/v1/pnl-card/0x${"ab".repeat(20)}/x` })).statusCode, 400);
  assert.equal(queries.length, 0);
});
