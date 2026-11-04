/// Runs one derivation pass against a real PostgreSQL that already has the indexer's schema
/// (`pnpm --filter @zeno/indexer db:migrate`). Skipped unless TEST_DATABASE_URL is set. The tables are emptied
/// first: point it at a scratch database, never a real one.
///
///   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/zeno_test pnpm --filter @zeno/indexer test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import postgres from "postgres";
import { stringToHex } from "viem";

const url = process.env.TEST_DATABASE_URL;
const WAD = 10n ** 18n;
const NVDA = `0x${Buffer.from("NVDA").toString("hex").padEnd(64, "0")}`;
const ALICE = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const BOB = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const usd = (n: number) => (BigInt(n) * 10n ** 6n).toString();

describe("trader stats against PostgreSQL", { skip: url ? undefined : "TEST_DATABASE_URL not set" }, () => {
  test("a pass reads the event log in chain order, prices the open position, and replaces the window", async () => {
    process.env.DATABASE_URL = url;
    const { getDb, getSql } = await import("./db/client.js");
    const { runTraderStats } = await import("./traderStatsJob.js");
    const raw = postgres(url as string);
    await raw`truncate events, trader_stats restart identity`;

    let n = 0;
    // Inserted out of order on purpose: block and log index decide, not the row id.
    const add = (block: number, logIndex: number, name: string, args: Record<string, unknown>) =>
      raw`insert into events (tx_hash, log_index, block_number, contract_name, event_name, args)
        values (${`0x${(++n).toString(16)}`}, ${logIndex}, ${block}, 't', ${name}, ${raw.json(args as never)})`;

    await add(30, 0, "PerpPositionClosed", { positionId: "1", realizedPnl: usd(60) });
    await add(10, 0, "PerpPositionOpened", { positionId: "1", owner: ALICE, marketId: NVDA, isLong: true, size: usd(5_000), collateral: usd(1_000), leverage: "5", entryPrice: String(190n * WAD) });
    await add(20, 0, "PerpPositionUpdated", { positionId: "1", newSize: usd(3_000), newCollateral: usd(600), realizedPnlDelta: usd(40) });
    await add(10, 1, "ProtocolFeeCollected", { marketId: NVDA, payer: ALICE, token: "0x1", amount: usd(2), feeType: stringToHex("TAKER", { size: 32 }) });
    await add(11, 0, "PerpPositionOpened", { positionId: "2", owner: BOB, marketId: NVDA, isLong: false, size: usd(10_000), collateral: usd(2_000), leverage: "5", entryPrice: String(200n * WAD) });
    await add(12, 0, "CollateralDeposited", { user: BOB, token: "0x1", amount: usd(9_999) });

    // Bob's position is open and the mark is 190: a short from 200 on 10,000 notional is +500.
    const reader = {
      getPerpPosition: async () => ({ open: true, isLong: false, marketId: NVDA, entryPrice: 200n * WAD, size: 10_000n * 10n ** 6n }),
      getMarkPrice: async () => 190n * WAD,
    };
    const config = { maxLivePositions: 10, optionGraceSeconds: 86_400 };
    assert.equal(await runTraderStats(getDb(), reader, config), 2);
    // A second pass replaces the rows rather than adding to them.
    assert.equal(await runTraderStats(getDb(), reader, config), 2);

    const rows = await raw<{ wallet: string; realised_pnl: string; unrealised_pnl: string; roi_bps: string; volume: string; trade_count: number; win_rate_bps: number | null; window: string }[]>`
      select * from trader_stats order by wallet`;
    assert.equal(rows.length, 2);
    const [alice, bob] = rows;
    assert.equal(alice?.wallet, ALICE.toLowerCase());
    assert.equal(alice?.window, "all");
    assert.equal(alice?.realised_pnl, usd(98)); // 40 + 60 - 2 fee
    assert.equal(alice?.volume, usd(10_000));
    assert.equal(alice?.win_rate_bps, 10_000);
    assert.equal(bob?.wallet, BOB.toLowerCase());
    assert.equal(bob?.unrealised_pnl, usd(500));
    assert.equal(bob?.roi_bps, "2500"); // 500 / 2,000
    assert.equal(bob?.win_rate_bps, null);

    await raw.end();
    await getSql().end();
  });
});
