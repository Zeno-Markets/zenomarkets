/// Runs the leaderboard and PNL card routes against a real PostgreSQL that already has the indexer's schema
/// (`pnpm --filter @zeno/indexer db:migrate`). Skipped unless TEST_DATABASE_URL is set. The tables are emptied
/// first: point it at a scratch database, never a real one.
///
///   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/zeno_test pnpm --filter @zeno/api test
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { resolveMarketId, type Zeno } from "@zeno/sdk";
import Fastify from "fastify";
import postgres from "postgres";
import { stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { visibilityMessage } from "./leaderboard.js";

const url = process.env.TEST_DATABASE_URL;
const WAD = 10n ** 18n;
const NVDA = resolveMarketId("NVDA");
const usd = (n: number) => BigInt(n) * 10n ** 6n;
const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("leaderboard routes against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  const sql = postgres(url ?? "postgres://unused", { transform: postgres.camel });
  const raw = postgres(url ?? "postgres://unused");
  const app = Fastify();
  let tx = 0;
  const botAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);

  async function stat(wallet: string, realised: bigint, unrealised: bigint, roiBps: number, volume: bigint, trades = 3, win: number | null = 5000) {
    await raw`insert into trader_stats (wallet, "window", realised_pnl, unrealised_pnl, capital_deployed, roi_bps, volume, trade_count, closed_count, win_rate_bps)
      values (${wallet}, 'all', ${realised.toString()}, ${unrealised.toString()}, '1', ${String(roiBps)}, ${volume.toString()}, ${trades}, 1, ${win})`;
  }
  async function event(name: string, args: Record<string, unknown>, txHash?: string) {
    tx += 1;
    await raw`insert into events (tx_hash, log_index, block_number, contract_name, event_name, args)
      values (${txHash ?? `0x${tx.toString(16).padStart(64, "0")}`}, ${tx}, ${tx}, 'test', ${name}, ${raw.json(args as never)})`;
  }

  // The chain, as the fake knows it: position 12 (open, long NVDA) and position 13 (closed).
  const zeno = {
    addresses: { settlementToken: w(0xaa) },
    erc20: { decimals: async () => 6 },
    portfolio: {
      getPerpPosition: async (id: bigint) => ({
        open: id === 12n,
        marketId: NVDA,
        entryPrice: 190n * WAD,
        size: usd(5_000),
        collateral: usd(1_000),
      }),
    },
    oracle: { getMarkPrice: async () => ({ price: 209n * WAD, timestamp: 1n }) },
  } as unknown as Zeno;

  before(async () => {
    if (!url) return;
    await raw`truncate events, trader_stats, leaderboard_visibility restart identity`;

    // Wallet numbers are arbitrary. Total PNL: 1 = 10, 2 = 9, 3 = 10 (ties 1 on volume), 4 = 100 (hidden),
    // 5 = -50. As text "9" sorts after "10", so a text sort would put wallet 2 first.
    await stat(w(1), 10n, 0n, 900, 50n);
    await stat(w(2), 9n, 0n, 1000, 20n);
    await stat(w(3), 6n, 4n, 900, 50n);
    await stat(w(4), 100n, 0n, 5000, 999n);
    await stat(w(5), -50n, 0n, -400, 7n);
    await raw`insert into leaderboard_visibility (wallet, hidden, issued_at) values (${w(4)}, true, 1)`;

    // Position 12: open long, owned by wallet 7. Position 13: closed, owned by the bot account.
    const owner = w(7);
    await event("PerpPositionOpened", { positionId: "12", owner, marketId: NVDA, isLong: true, size: usd(5_000).toString(), collateral: usd(1_000).toString(), leverage: "5", entryPrice: (190n * WAD).toString() }, "0xopen12");
    await event("ProtocolFeeCollected", { marketId: NVDA, payer: owner, token: w(0xaa), amount: usd(2).toString(), feeType: stringToHex("TAKER", { size: 32 }) }, "0xopen12");
    await event("ProtocolFeeCollected", { marketId: NVDA, payer: owner, token: w(0xaa), amount: usd(99).toString(), feeType: stringToHex("OPTION_OPEN", { size: 32 }) }, "0xopen12");
    await event("FundingPaid", { positionId: "12", marketId: NVDA, amount: (-usd(3)).toString(), fundingIndex: "1" });

    const bot = botAccount.address;
    await event("PerpPositionOpened", { positionId: "13", owner: bot, marketId: NVDA, isLong: true, size: usd(5_000).toString(), collateral: usd(1_000).toString(), leverage: "5", entryPrice: (190n * WAD).toString() }, "0xopen13");
    await event("PerpPositionClosed", { positionId: "13", realizedPnl: usd(100).toString() }, "0xclose13");
    await event("ProtocolFeeCollected", { marketId: NVDA, payer: bot, token: w(0xaa), amount: usd(5).toString(), feeType: stringToHex("TAKER", { size: 32 }) }, "0xclose13");

    await app.register(async (instance) => {
      registerLeaderboardRoutes(instance, zeno, sql, botAccount.address.toLowerCase());
    });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await sql.end();
    await raw.end();
  });

  const board = async (query = "") => (await app.inject({ url: `/v1/leaderboard${query}` })).json();

  test("pnl ranks numerically, breaks ties on volume then wallet, and leaves out a hidden wallet", async () => {
    const json = await board();
    assert.equal(json.metric, "pnl");
    assert.equal(json.window, "all");
    assert.equal(json.sample, false);
    assert.equal(json.settlementDecimals, 6);
    assert.equal(json.total, 4);
    assert.ok(json.updatedAt);
    // Wallets 1 and 3 tie on total PNL (10) and on volume (50), so wallet ascending decides; 2 (9) follows.
    assert.deepEqual(json.entries.map((e: { wallet: string }) => e.wallet), [w(1), w(3), w(2), w(5)]);
    assert.deepEqual(json.entries.map((e: { rank: number }) => e.rank), [1, 2, 3, 4]);
    assert.equal(json.entries[1].realisedPnl, "6");
    assert.equal(json.entries[1].unrealisedPnl, "4");
    assert.equal(json.entries[1].totalPnl, "10");
    assert.equal(json.entries[0].sample, false);
  });

  test("roi and volume rank by their own column, and a page is a slice of the same order", async () => {
    assert.deepEqual((await board("?metric=roi")).entries.map((e: { wallet: string }) => e.wallet), [w(2), w(1), w(3), w(5)]);
    assert.deepEqual((await board("?metric=volume")).entries.map((e: { wallet: string }) => e.wallet), [w(1), w(3), w(2), w(5)]);
    const page = await board("?limit=2&offset=2");
    assert.equal(page.total, 4);
    assert.deepEqual(page.entries.map((e: { wallet: string; rank: number }) => [e.wallet, e.rank]), [[w(2), 3], [w(5), 4]]);
  });

  test("a bad query is a 400 and an unsupported window is refused", async () => {
    assert.equal((await app.inject({ url: "/v1/leaderboard?metric=nope" })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/leaderboard?window=24h" })).statusCode, 400);
  });

  test("the sample board is the simulator wallets when they have stats, else the synthetic fixture", async () => {
    // The bot has no stats row yet, so the fixture answers.
    const synthetic = await board("?sample=1");
    assert.equal(synthetic.sample, true);
    assert.equal(synthetic.total, 12);
    assert.equal(synthetic.updatedAt, null);
    assert.ok(synthetic.entries.every((e: { sample: boolean }) => e.sample));

    await raw`insert into trader_stats (wallet, "window", realised_pnl, unrealised_pnl, capital_deployed, roi_bps, volume, trade_count, closed_count, win_rate_bps)
      values (${botAccount.address.toLowerCase()}, 'all', '5', '0', '1', '5', '5', 1, 1, 10000)`;
    const real = await board("?sample=1");
    assert.equal(real.sample, true);
    assert.equal(real.total, 1);
    assert.equal(real.entries[0].wallet, botAccount.address.toLowerCase());
    // The same wallet is flagged on the ordinary board, which is otherwise unlabelled.
    const ordinary = await board();
    assert.equal(ordinary.sample, false);
    assert.equal(ordinary.entries.find((e: { wallet: string }) => e.wallet === botAccount.address.toLowerCase()).sample, true);
    await raw`delete from trader_stats where wallet = ${botAccount.address.toLowerCase()}`;
  });

  test("an empty board is a 200 with no entries", async () => {
    await raw`create temp table keep as select * from trader_stats`;
    await raw`truncate trader_stats`;
    const json = await board();
    assert.equal(json.total, 0);
    assert.deepEqual(json.entries, []);
    assert.equal(json.updatedAt, null);
    assert.equal((await app.inject({ url: "/v1/leaderboard" })).statusCode, 200);
    await raw`insert into trader_stats select * from keep`;
    await raw`drop table keep`;
  });

  test("the PNL card of an open position joins events and the chain", async () => {
    const response = await app.inject({ url: `/v1/pnl-card/${w(7).toUpperCase().replace("0X", "0x")}/12` });
    assert.equal(response.statusCode, 200);
    const card = response.json();
    assert.equal(card.status, "open");
    assert.equal(card.symbol, "NVDA");
    assert.equal(card.side, "long");
    assert.equal(card.fees, usd(2).toString(), "the option fee in the same transaction is not a perp fee");
    assert.equal(card.fundingPnl, (-usd(3)).toString());
    assert.equal(card.unrealisedPnl, usd(500).toString());
    assert.equal(card.totalPnl, usd(495).toString());
    assert.equal(card.sample, false);
  });

  test("the PNL card of a closed position is flagged sample for a simulator wallet, and carries its exit", async () => {
    const card = (await app.inject({ url: `/v1/pnl-card/${botAccount.address}/13` })).json();
    assert.equal(card.status, "closed");
    assert.equal(card.sample, true);
    assert.equal(card.pricePnl, usd(100).toString());
    assert.equal(card.fees, usd(5).toString());
    assert.equal(card.totalPnl, usd(95).toString());
    assert.equal(card.unrealisedPnl, "0");
    assert.ok(card.exitPrice);
  });

  test("a missing position, someone else's position, and a bad path are told apart only where they should be", async () => {
    const missing = await app.inject({ url: `/v1/pnl-card/${w(7)}/999` });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: `no position 999 for wallet ${w(7)}` });
    assert.equal((await app.inject({ url: `/v1/pnl-card/${w(8)}/12` })).statusCode, 404);
    assert.equal((await app.inject({ url: "/v1/pnl-card/nope/12" })).statusCode, 400);
    assert.equal((await app.inject({ url: `/v1/pnl-card/${w(7)}/abc` })).statusCode, 400);
  });

  test("opting out hides the wallet from the board and its card, and opting back in restores it", async () => {
    const account = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const me = account.address.toLowerCase();
    await event("PerpPositionOpened", { positionId: "20", owner: me, marketId: NVDA, isLong: false, size: "10", collateral: "2", leverage: "5", entryPrice: "1" });
    await stat(me, 1n, 0n, 1, 1n);

    const issuedAt = Math.floor(Date.now() / 1000);
    const send = async (hidden: boolean, at: number, signer = account) => {
      const signature = await signer.signMessage({ message: visibilityMessage(me, hidden, at) });
      return app.inject({ method: "POST", url: "/v1/leaderboard/visibility", payload: { wallet: me, hidden, issuedAt: at, signature } });
    };

    assert.equal((await app.inject({ url: `/v1/leaderboard/visibility/${me}` })).json().hidden, false);
    assert.ok((await board()).entries.some((e: { wallet: string }) => e.wallet === me));

    assert.equal((await send(true, issuedAt, privateKeyToAccount(`0x${"44".repeat(32)}`))).statusCode, 401, "another key cannot hide this wallet");
    const hidden = await send(true, issuedAt);
    assert.equal(hidden.statusCode, 200);
    assert.deepEqual(hidden.json(), { wallet: me, hidden: true });
    assert.equal((await app.inject({ url: `/v1/leaderboard/visibility/${me}` })).json().hidden, true);
    assert.ok(!(await board()).entries.some((e: { wallet: string }) => e.wallet === me));
    assert.equal((await app.inject({ url: `/v1/pnl-card/${me}/20` })).statusCode, 404, "the card goes with the board entry");

    assert.equal((await send(false, issuedAt)).statusCode, 409, "a change not newer than the last one is a replay");
    assert.equal((await send(false, issuedAt - 1)).statusCode, 409);
    assert.equal((await send(false, issuedAt - 100_000)).statusCode, 400, "a stale signature is refused outright");

    assert.equal((await send(false, issuedAt + 1)).statusCode, 200);
    assert.ok((await board()).entries.some((e: { wallet: string }) => e.wallet === me));
    assert.notEqual((await app.inject({ url: `/v1/pnl-card/${me}/20` })).statusCode, 404);
  });
});
