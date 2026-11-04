/// The pure sizing rules need nothing. The executor passes run against a real PostgreSQL that has the indexer's schema
/// (`pnpm --filter @zeno/indexer db:migrate`) and are skipped unless TEST_DATABASE_URL is set. The copy tables are
/// emptied first: point it at a scratch database.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { ZenoContractError, type Zeno } from "@zeno/sdk";
import type { Address, PerpPosition } from "@zeno/types";
import postgres from "postgres";
import { stringToHex } from "viem";
import { createCopyExecutor, decide } from "./copy.js";

const USD = 10n ** 6n;
const follow = { maxTradeSize: 2_000n * USD, maxExposure: 3_000n * USD, maxLeverage: 5, markets: null as string[] | null };
const trade = { market: "NVDA", collateral: 100n * USD, leverage: 5n };
const room = { leaderBalance: 1_000n * USD, followerBalance: 500n * USD, followerAvailable: 500n * USD, openExposure: 0n };

test("a leader trade is mirrored in proportion to the two balances, at the leader's leverage", () => {
  // The leader risks 100 of 1,000 (10%); the follower has 500, so risks 50 at 5x: a 250 position.
  assert.deepEqual(decide({ trade, follow, ...room }), { action: "open", collateral: 50n * USD, leverage: 5n, size: 250n * USD });
});

test("each cap skips the trade with its own reason, and nothing is mirrored in part", () => {
  const skip = (over: Partial<Parameters<typeof decide>[0]>) => decide({ trade, follow, ...room, ...over }) as { action: string; reason: string };
  assert.match(skip({ follow: { ...follow, markets: ["TSLA"] } }).reason, /not one of the markets/);
  assert.match(skip({ follow: { ...follow, maxLeverage: 3 } }).reason, /5x, over your 3x/);
  assert.match(skip({ follow: { ...follow, maxTradeSize: 100n * USD } }).reason, /size limit per trade/);
  assert.match(skip({ openExposure: 2_900n * USD }).reason, /total exposure limit/);
  assert.match(skip({ followerAvailable: 10n * USD }).reason, /free margin/);
  assert.match(skip({ leaderBalance: 0n }).reason, /could not be sized/);
  assert.match(skip({ followerBalance: 0n }).reason, /too small/);
  assert.ok(["open", "skip"].includes(skip({}).action));
});

describe("the executor against PostgreSQL", { skip: process.env.TEST_DATABASE_URL ? undefined : "TEST_DATABASE_URL not set" }, () => {
  const raw = postgres(process.env.TEST_DATABASE_URL ?? "postgres://unused");
  const LEADER = "0x00000000000000000000000000000000000000a1" as Address;
  const SUB = "0x00000000000000000000000000000000000000b2" as Address;
  const EXECUTOR = "0x00000000000000000000000000000000000000e3" as Address;
  const NVDA = stringToHex("NVDA", { size: 32 });

  // A tiny in-memory chain: positions by id, who owns which, balances, and a log of what the executor sent.
  let positions: Map<bigint, PerpPosition>;
  let owned: Map<string, bigint[]>;
  let sent: string[];
  let delegate: boolean;
  let nextId: bigint;
  let refuse: string | undefined;

  const position = (id: bigint, owner: Address, over: Partial<PerpPosition> = {}): PerpPosition =>
    ({ positionId: id, marketId: NVDA, isLong: true, entryPrice: 0n, size: 500n * USD, collateral: 100n * USD, leverage: 5n, realizedPnl: 0n, fundingAccrued: 0n, lastFundingIndex: 0n, open: true, owner, ...over }) as PerpPosition;
  const give = (owner: Address, p: PerpPosition) => {
    positions.set(p.positionId, p);
    owned.set(owner.toLowerCase(), [...(owned.get(owner.toLowerCase()) ?? []), p.positionId]);
  };

  const zeno = {
    addresses: { perpPositionManager: "0x0000000000000000000000000000000000000f1", settlementToken: "0x0000000000000000000000000000000000000f2" },
    vault: { balances: async () => ({ balance: 1_000n * USD, lockedMargin: 0n, available: 1_000n * USD }) },
    subaccounts: {
      isDelegate: async () => delegate,
      balances: async () => ({ balance: 500n * USD, lockedMargin: 0n, available: 500n * USD }),
      execute: async (_sub: Address, call: { kind: string; id?: bigint; collateral?: bigint; leverage?: bigint; isLong?: boolean }) => {
        if (refuse) throw Object.assign(new ZenoContractError(refuse, [], undefined), {});
        if (call.kind === "open") {
          sent.push(`open ${call.collateral}x${call.leverage}`);
          give(SUB, position(nextId++, SUB, { collateral: call.collateral!, leverage: call.leverage!, size: call.collateral! * call.leverage!, isLong: call.isLong! }));
        } else {
          sent.push(`close ${call.id}`);
          positions.set(call.id!, { ...positions.get(call.id!)!, open: false });
        }
        return `0x${sent.length.toString(16).padStart(64, "0")}`;
      },
    },
    trading: {
      prepareOpenPerp: async (p: { side: string; collateral: bigint; leverage: bigint }) => ({ kind: "open", collateral: p.collateral, leverage: BigInt(p.leverage), isLong: p.side === "LONG" }),
      prepareClosePerp: async (id: bigint) => ({ kind: "close", id }),
    },
  } as unknown as Zeno;
  const publicClient = {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      if (functionName === "getUserPositions") return owned.get((args[0] as string).toLowerCase()) ?? [];
      const p = positions.get(args[0] as bigint)!;
      return p;
    },
  };
  const executor = () => createCopyExecutor({ zeno, publicClient: publicClient as never, sql: raw, executor: EXECUTOR });
  const addFollow = async (over: { active?: boolean; maxLeverage?: number; maxTrade?: bigint } = {}) =>
    raw`insert into copy_follows (follower, leader, subaccount, max_trade_size, max_exposure, max_leverage, markets, active, issued_at)
        values ('0xf0110e4', ${LEADER}, ${SUB}, ${String(over.maxTrade ?? 2_000n * USD)}, ${String(3_000n * USD)}, ${over.maxLeverage ?? 5}, null, ${over.active ?? true}, 1) returning id`;

  before(async () => {
    await raw`truncate copy_follows, copy_executions restart identity`;
  });
  after(async () => {
    await raw.end();
  });
  beforeEach(async () => {
    await raw`truncate copy_follows, copy_executions restart identity`;
    positions = new Map();
    owned = new Map();
    sent = [];
    delegate = true;
    nextId = 1000n;
    refuse = undefined;
  });

  test("a leader long is mirrored within one pass, in proportion, and the leader's close is mirrored", async () => {
    await addFollow();
    give(LEADER, position(1n, LEADER));
    const ex = executor();
    assert.deepEqual(await ex.tick(), { opened: 1, closed: 0, skipped: 0 });
    assert.deepEqual(sent, [`open ${50n * USD}x5`], "100 of 1,000 for the leader is 50 of 500 for the follower");
    const [row] = await raw`select status, follower_position_id from copy_executions`;
    assert.equal(row!.status, "open");
    assert.equal(row!.follower_position_id, "1000");
    assert.deepEqual(await ex.tick(), { opened: 0, closed: 0, skipped: 0 }, "a second pass does not open it again");

    positions.set(1n, { ...positions.get(1n)!, open: false });
    assert.deepEqual(await ex.tick(), { opened: 0, closed: 1, skipped: 0 });
    assert.deepEqual(sent.slice(1), ["close 1000"]);
    assert.equal((await raw`select status from copy_executions`)[0]!.status, "closed");
  });

  test("a position the leader held before the follow, and one that closed unseen, are never copied", async () => {
    const [f] = await addFollow();
    give(LEADER, position(1n, LEADER));
    await raw`insert into copy_executions (follow_id, leader_position_id, status, market, is_long, leader_size) values (${f!.id}, '1', 'existing', 'NVDA', true, '1')`;
    give(LEADER, position(2n, LEADER, { open: false }));
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 0 });
    assert.deepEqual(sent, []);
  });

  test("a follower over a cap records a skip with the reason and opens nothing", async () => {
    await addFollow({ maxLeverage: 3 });
    give(LEADER, position(1n, LEADER));
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 1 });
    assert.deepEqual(sent, []);
    const [row] = await raw`select status, reason from copy_executions`;
    assert.equal(row!.status, "skipped");
    assert.match(row!.reason, /over your 3x limit/);
  });

  test("a stopped follow mirrors nothing, and neither does a follow whose executor was revoked on chain", async () => {
    await addFollow({ active: false });
    give(LEADER, position(1n, LEADER));
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 0 });
    await raw`update copy_follows set active = true`;
    delegate = false;
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 0 });
    assert.deepEqual(sent, []);
    assert.equal((await raw`select count(*)::int as n from copy_executions`)[0]!.n, 0);
  });

  test("a chain refusal is a skip with a plain sentence, never a raw error name", async () => {
    await addFollow();
    give(LEADER, position(1n, LEADER));
    refuse = "MarketPaused";
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 1 });
    const [row] = await raw`select status, reason from copy_executions`;
    assert.equal(row!.status, "skipped");
    assert.equal(row!.reason, "The market is paused.");
  });

  test("an open interrupted before it was recorded is marked failed and not retried", async () => {
    const [f] = await addFollow();
    give(LEADER, position(1n, LEADER));
    await raw`insert into copy_executions (follow_id, leader_position_id, status, market, is_long, leader_size) values (${f!.id}, '1', 'opening', 'NVDA', true, '1')`;
    assert.deepEqual(await executor().tick(), { opened: 0, closed: 0, skipped: 0 });
    assert.deepEqual(sent, []);
    assert.equal((await raw`select status from copy_executions`)[0]!.status, "failed");
  });
});
