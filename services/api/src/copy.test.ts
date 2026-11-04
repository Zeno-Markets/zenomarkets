/// Copy trading follows against a real PostgreSQL that has the indexer's schema (`pnpm --filter @zeno/indexer db:migrate`).
/// The signature, window and parsing tests need no database; the route tests are skipped unless TEST_DATABASE_URL is set.
/// Point it at a scratch database: the copy tables are emptied first.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { resolveMarketId, type Zeno } from "@zeno/sdk";
import Fastify from "fastify";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { followMessage, parseFollowBody, signedBy, unfollowMessage, withinWindow } from "./copy.js";
import { registerCopyRoutes } from "./routes/copy.js";

const url = process.env.TEST_DATABASE_URL;
const follower = privateKeyToAccount(`0x${"11".repeat(32)}`);
const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`);
const LEADER = "0x00000000000000000000000000000000000000a1";
const SUB = "0x00000000000000000000000000000000000000b2";
const NVDA = resolveMarketId("NVDA");
const now = () => Math.floor(Date.now() / 1000);

const base = (issuedAt = now()) => ({
  follower: follower.address.toLowerCase(),
  leader: LEADER,
  subaccount: SUB,
  maxTradeSize: "1000000000",
  maxExposure: "5000000000",
  maxLeverage: 5,
  markets: ["NVDA"] as string[] | null,
  issuedAt,
});

test("a follow body is validated, and a wallet cannot follow itself", () => {
  assert.ok(!("error" in parseFollowBody({ ...base(), signature: "0x01" })));
  assert.match((parseFollowBody({ ...base(), maxLeverage: 20, signature: "0x01" }) as { error: string }).error, /maxLeverage/);
  assert.match((parseFollowBody({ ...base(), maxTradeSize: "0", signature: "0x01" }) as { error: string }).error, /maxTradeSize/);
  assert.match((parseFollowBody({ ...base(), leader: base().follower, signature: "0x01" }) as { error: string }).error, /itself/);
  assert.match((parseFollowBody({ ...base(), markets: [], signature: "0x01" }) as { error: string }).error, /markets/);
});

test("only the follower's own signature over the exact caps is accepted, and only inside the window", async () => {
  const message = followMessage(base());
  const signature = await follower.signMessage({ message });
  assert.ok(await signedBy(follower.address, message, signature));
  assert.ok(!(await signedBy(follower.address, message, await stranger.signMessage({ message }))));
  assert.ok(!(await signedBy(follower.address, followMessage({ ...base(), maxLeverage: 10 }), signature)), "a changed cap voids the signature");
  assert.ok(!(await signedBy(follower.address, message, "0x1234")));
  assert.ok(withinWindow(now()) && !withinWindow(now() - 3_600));
});

describe("copy routes against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  const sql = postgres(url ?? "postgres://unused", { transform: postgres.camel });
  const raw = postgres(url ?? "postgres://unused");
  const app = Fastify();
  const zeno = {
    subaccounts: { list: async () => [{ address: SUB, index: 0n }] },
    portfolio: { positions: async () => ({ options: [], perps: [{ positionId: 7n, marketId: NVDA, isLong: true, size: 5_000_000n, open: true }, { positionId: 8n, marketId: NVDA, isLong: false, size: 1n, open: false }] }) },
  } as unknown as Zeno;

  before(async () => {
    await raw`truncate copy_follows, copy_executions restart identity`;
    registerCopyRoutes(app, zeno, sql as never, "0x75962B2A0750293E01E8205b31717329Fae78147");
    await app.ready();
  });
  after(async () => {
    await app.close();
    await sql.end();
    await raw.end();
  });

  const post = async (path: string, body: unknown) => app.inject({ method: "POST", url: path, payload: body as object });
  const signedFollow = async (overrides: Partial<ReturnType<typeof base>> = {}) => {
    const r = { ...base(), ...overrides };
    return { ...r, signature: await follower.signMessage({ message: followMessage(r) }) };
  };

  test("config names the executor to delegate to", async () => {
    const res = await app.inject({ url: "/v1/copy/config" });
    assert.equal(res.json().executor, "0x75962b2a0750293e01e8205b31717329fae78147");
  });

  test("a signed follow is stored, and the leader's open positions are recorded as already open", async () => {
    const res = await post("/v1/copy/follows", await signedFollow());
    assert.equal(res.statusCode, 200, res.body);
    const [f] = await raw`select * from copy_follows`;
    assert.equal(f!.active, true);
    assert.equal(f!.max_leverage, 5);
    const rows = await raw`select leader_position_id, status from copy_executions order by leader_position_id`;
    assert.deepEqual(rows.map((r) => [r.leader_position_id, r.status]), [["7", "existing"]], "only the open position, marked existing");
  });

  test("a bad signature, a stranger's signature and a wrong subaccount are refused", async () => {
    const body = await signedFollow({ issuedAt: now() + 5 });
    assert.equal((await post("/v1/copy/follows", { ...body, maxLeverage: 2 })).statusCode, 401);
    const sig = await stranger.signMessage({ message: followMessage(base(now() + 5)) });
    assert.equal((await post("/v1/copy/follows", { ...body, signature: sig })).statusCode, 401);
    const other = await signedFollow({ subaccount: "0x00000000000000000000000000000000000000c3", issuedAt: now() + 5 });
    assert.equal((await post("/v1/copy/follows", other)).statusCode, 400);
    assert.equal((await post("/v1/copy/follows", await signedFollow({ issuedAt: now() - 3_600 }))).statusCode, 400);
  });

  test("an older signed change cannot undo a newer one", async () => {
    assert.equal((await post("/v1/copy/follows", await signedFollow({ issuedAt: now() - 5 }))).statusCode, 409);
  });

  test("unfollow needs the follower's signature, stops the follow at once, and replay is refused", async () => {
    const u = { follower: follower.address.toLowerCase(), leader: LEADER, issuedAt: now() + 10 };
    const bad = await stranger.signMessage({ message: unfollowMessage(u) });
    assert.equal((await post("/v1/copy/unfollow", { ...u, signature: bad })).statusCode, 401);
    const good = await follower.signMessage({ message: unfollowMessage(u) });
    assert.equal((await post("/v1/copy/unfollow", { ...u, signature: good })).statusCode, 200);
    const [f] = await raw`select active from copy_follows`;
    assert.equal(f!.active, false);
    assert.equal((await post("/v1/copy/unfollow", { ...u, signature: good })).statusCode, 404, "the same signature cannot be replayed");
  });

  test("the list shows the follow and counts followers", async () => {
    const res = await app.inject({ url: `/v1/copy/follows?follower=${follower.address}` });
    assert.equal(res.json().follows.length, 1);
    assert.equal((await app.inject({ url: `/v1/copy/followers/${LEADER}` })).json().followers, 0);
  });
});
