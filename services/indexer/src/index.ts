import { loadDotEnv } from "@zeno/config";
loadDotEnv();

import { requireEnv, resolveAddresses, resolveChainId } from "@zeno/config";
import { Zeno } from "@zeno/sdk";
import { createPublicClient, http, parseEventLogs } from "viem";
import { and, eq, lt, sql as sqlOp } from "drizzle-orm";
import { getDb, getSql } from "./db/client.js";
import { events, indexerState, markets, priceTicks } from "./db/schema.js";
import { allEventsAbi, contractNamesByAddress, watchedAddresses } from "./events.js";
import { blockBeforeFirstIndexed } from "./startBlock.js";
import { serializeArgs } from "./serialize.js";
import { runTraderStats, type LiveReader } from "./traderStatsJob.js";
import { evaluateAlerts, webPushSender, type PushSender } from "./alerts.js";

const POLL_INTERVAL_MS = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);
/// Free-plan mode: run one pass (tick, price sample, trader stats) and exit, so a Railway cron service
/// (`*/5 * * * *`) pays only for the seconds a pass takes. Unset keeps the always-on loop.
const RUN_ONCE = process.env.INDEXER_RUN_ONCE === "true";
/// getLogs range width per call. The default of 10 fits the Alchemy free tier, which caps
/// eth_getLogs at 10 blocks. Robinhood's official testnet RPC (https://rpc.testnet.chain.robinhood.com)
/// only rejects a query that matches more than 10000 logs, so set this to about 2000 there.
const MAX_BLOCK_RANGE = BigInt(process.env.INDEXER_MAX_BLOCK_RANGE ?? 10);
/// Skip ahead to this block when the indexer is behind it. For a deployment whose earlier blocks hold nothing of
/// interest (mainnet before its open), where walking them on a free RPC would take days. Unset: no skipping.
const FROM_BLOCK = process.env.INDEXER_FROM_BLOCK ? BigInt(process.env.INDEXER_FROM_BLOCK) : undefined;
if (MAX_BLOCK_RANGE < 1n) {
  throw new Error(`INDEXER_MAX_BLOCK_RANGE must be at least 1, got ${MAX_BLOCK_RANGE}`);
}

/// How often to record each active market's index price for history and 24h change.
const PRICE_SAMPLE_INTERVAL_MS = Number(process.env.PRICE_SAMPLE_INTERVAL_MS ?? 60_000);
const PRICE_TICK_RETENTION_DAYS = Number(process.env.PRICE_TICK_RETENTION_DAYS ?? 8);

/// How often to re-derive the leaderboard statistics from `events`. A full pass reads every trading event
/// and prices each open position at the live mark, so a minute is plenty for a display board.
const TRADER_STATS_INTERVAL_MS = Number(process.env.LEADERBOARD_INTERVAL_MS ?? 60_000);
/// Open positions priced against the chain per pass, one RPC read each plus one per market.
const LEADERBOARD_MAX_LIVE_POSITIONS = Number(process.env.LEADERBOARD_MAX_LIVE_POSITIONS ?? 200);
/// An option with no close or exercise event this long after expiry is treated as expired worthless.
const LEADERBOARD_OPTION_GRACE_SECONDS = Number(process.env.LEADERBOARD_OPTION_GRACE_HOURS ?? 24) * 3600;

/// How often to check price alerts against the latest sampled prices. On the testnet cron (`*/5`) a pass is one run,
/// so alerts there fire at that cadence.
const ALERT_CHECK_INTERVAL_MS = Number(process.env.ALERT_CHECK_INTERVAL_MS ?? 60_000);
/// A price older than this is a closed or stale market, and its alerts wait for a fresh one.
const ALERT_MAX_PRICE_AGE_MS = Number(process.env.ALERT_MAX_PRICE_AGE_MS ?? 15 * 60_000);
const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 30);

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const contractNames = contractNamesByAddress(addresses);
const addressList = watchedAddresses(addresses);

// A request that hangs fails after 20 s (and is retried), so a stuck RPC shows up in the log instead of a silent run.
const rpcTransport = () => http(requireEnv("RPC_URL"), { timeout: 20_000, retryCount: 3, retryDelay: 500 });
const publicClient = createPublicClient({ transport: rpcTransport() });
const zeno = new Zeno({ chainId, transport: rpcTransport() });
const db = getDb();

async function lastIndexedBlock(): Promise<bigint> {
  const [row] = await db.select().from(indexerState).where(eq(indexerState.id, 1));
  if (row) return row.lastIndexedBlock;

  // First run: start at the chain head, or replay from INDEXER_START_BLOCK (the deploy block).
  const currentBlock = await publicClient.getBlockNumber();
  const startBlock = blockBeforeFirstIndexed(currentBlock, process.env.INDEXER_START_BLOCK);
  await db.insert(indexerState).values({ id: 1, lastIndexedBlock: startBlock });
  return startBlock;
}

async function upsertMarket(marketId: `0x${string}`, blockNumber: bigint) {
  const config = await zeno.markets.get(marketId);
  await db
    .insert(markets)
    .values({
      marketId: config.marketId,
      underlyingToken: config.underlyingToken,
      oracleId: config.oracleId,
      optionsEnabled: config.optionsEnabled,
      perpsEnabled: config.perpsEnabled,
      maxLeverage: config.maxLeverage.toString(),
      openInterestCap: config.openInterestCap.toString(),
      active: config.active,
      blockNumber,
    })
    .onConflictDoUpdate({
      target: markets.marketId,
      set: {
        underlyingToken: config.underlyingToken,
        oracleId: config.oracleId,
        optionsEnabled: config.optionsEnabled,
        perpsEnabled: config.perpsEnabled,
        maxLeverage: config.maxLeverage.toString(),
        openInterestCap: config.openInterestCap.toString(),
        active: config.active,
        blockNumber,
        updatedAt: sqlOp`now()`,
      },
    });
}

/// Fills the `markets` table from the registry, the single source of truth for markets. Events keep
/// it current afterwards, but an indexer that starts after a deployment never sees that
/// deployment's `MarketAdded` events, and would serve an empty market list.
async function syncMarkets() {
  const head = await publicClient.getBlockNumber();
  console.log(`indexer: chain head is ${head}`);
  const listed = await zeno.markets.list();
  console.log(`indexer: registry lists ${listed.length} market(s)`);
  for (const market of listed) await upsertMarket(market.marketId, head);
  console.log(`indexer: ${listed.length} market(s) synced from the registry`);
}

async function indexRange(fromBlock: bigint, toBlock: bigint) {
  const logs = await publicClient.getLogs({ address: addressList, fromBlock, toBlock });
  const decoded = parseEventLogs({ abi: allEventsAbi, logs });

  if (decoded.length > 0) {
    await db
      .insert(events)
      .values(
        decoded.map((log) => ({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          contractName: contractNames.get(log.address.toLowerCase() as typeof log.address) ?? "unknown",
          eventName: log.eventName,
          args: serializeArgs(log.args),
        })),
      )
      .onConflictDoNothing({ target: [events.txHash, events.logIndex] });

    for (const log of decoded) {
      if (log.eventName === "MarketAdded" || log.eventName === "MarketUpdated") {
        await upsertMarket((log.args as { marketId: `0x${string}` }).marketId, log.blockNumber);
      }
    }
  }

  await db
    .update(indexerState)
    .set({ lastIndexedBlock: toBlock })
    .where(eq(indexerState.id, 1));
}

async function tick() {
  const resumed = (await lastIndexedBlock()) + 1n;
  console.log(`indexer: resuming from block ${resumed}${FROM_BLOCK !== undefined ? `, start block ${FROM_BLOCK}` : ""}`);
  const from = FROM_BLOCK !== undefined && FROM_BLOCK > resumed ? FROM_BLOCK : resumed;
  const head = await publicClient.getBlockNumber();
  if (from > head) return;

  let cursor = from;
  while (cursor <= head) {
    const end = cursor + MAX_BLOCK_RANGE - 1n > head ? head : cursor + MAX_BLOCK_RANGE - 1n;
    await indexRange(cursor, end);
    console.log(`indexer: processed blocks ${cursor}-${end}`);
    cursor = end + 1n;
  }
}

let lastSampleAt = 0;

/// Records the index price of every active market. A market whose oracle is currently stale or
/// paused is skipped for this round rather than failing the whole indexer tick.
async function sampleIndexPrices() {
  if (Date.now() - lastSampleAt < PRICE_SAMPLE_INTERVAL_MS) return;
  lastSampleAt = Date.now();

  const active = await db.select({ marketId: markets.marketId }).from(markets).where(eq(markets.active, true));
  for (const { marketId } of active) {
    try {
      const { price } = await zeno.oracle.getIndexPrice(marketId);
      await db.insert(priceTicks).values({ marketId, price: price.toString() });
    } catch (error) {
      // One line: a market whose session is closed reverts on every sample, and the full stack floods the log.
      console.warn(`indexer: could not sample index price for ${marketId}: ${(error as { shortMessage?: string }).shortMessage ?? "failed"}`);
    }
  }

  const cutoff = new Date(Date.now() - PRICE_TICK_RETENTION_DAYS * 24 * 3600 * 1000);
  await db.delete(priceTicks).where(and(lt(priceTicks.sampledAt, cutoff)));
}

let lastStatsAt = 0;

const liveReader: LiveReader = {
  getPerpPosition: async (positionId) => {
    const position = await zeno.portfolio.getPerpPosition(positionId);
    return { open: position.open, isLong: position.isLong, marketId: position.marketId, entryPrice: position.entryPrice, size: position.size };
  },
  getMarkPrice: async (marketId) => (await zeno.oracle.getMarkPrice(marketId)).price,
};

/// Re-derives `trader_stats` from the event log on a fixed interval. It reads only what the indexer already
/// recorded, plus the chain for open positions' live price, and writes nothing a trade depends on.
async function deriveTraderStats() {
  if (Date.now() - lastStatsAt < TRADER_STATS_INTERVAL_MS) return;
  lastStatsAt = Date.now();
  const wallets = await runTraderStats(
    db,
    liveReader,
    { maxLivePositions: LEADERBOARD_MAX_LIVE_POSITIONS, optionGraceSeconds: LEADERBOARD_OPTION_GRACE_SECONDS },
    (message, error) => console.warn(`indexer: ${message}`, error ?? ""),
  );
  console.log(`indexer: trader stats refreshed for ${wallets} wallet(s)`);
}

let lastAlertsAt = 0;

/// Web Push needs the VAPID pair. Without it alerts still fire and land in the in-app bell.
const pushSender: PushSender | undefined =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? webPushSender({ subject: process.env.VAPID_SUBJECT ?? "https://www.zenomarkets.tech", publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY })
    : undefined;

/// Fires the price alerts the latest prices have crossed. Runs after the price sample so it sees this pass's prices.
async function checkAlerts() {
  if (Date.now() - lastAlertsAt < ALERT_CHECK_INTERVAL_MS) return;
  lastAlertsAt = Date.now();
  const fired = await evaluateAlerts(getSql(), pushSender, { maxPriceAgeMs: ALERT_MAX_PRICE_AGE_MS, retentionDays: NOTIFICATION_RETENTION_DAYS });
  if (fired > 0) console.log(`indexer: ${fired} price alert(s) fired`);
}

async function main() {
  console.log(`indexer: watching ${addressList.length} contracts on chain ${chainId}`);
  try {
    await syncMarkets();
  } catch (error) {
    console.error("indexer: could not sync markets from the registry", error);
  }
  do {
    try {
      await tick();
    } catch (error) {
      console.error("indexer: tick failed", error);
    }
    try {
      await sampleIndexPrices();
    } catch (error) {
      console.error("indexer: price sampling failed", error);
    }
    try {
      await checkAlerts();
    } catch (error) {
      console.error("indexer: price alerts failed", error);
    }
    try {
      await deriveTraderStats();
    } catch (error) {
      console.error("indexer: trader stats failed", error);
    }
    if (!RUN_ONCE) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  } while (!RUN_ONCE);
  if (RUN_ONCE) {
    await getSql().end();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("indexer: fatal error", error);
  getSql()
    .end()
    .finally(() => process.exit(1));
});
