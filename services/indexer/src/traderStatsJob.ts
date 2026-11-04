import { asc, eq, inArray } from "drizzle-orm";
import type { getDb } from "./db/client.js";
import { events, traderStats } from "./db/schema.js";
import {
  foldTraderStats,
  openPerpPositionIds,
  perpUnrealisedPnl,
  STAT_EVENT_NAMES,
  type EventRow,
  type TraderStat,
} from "./traderStats.js";

type Db = ReturnType<typeof getDb>;

/// Launch has one window. A `24h` value is a Phase 18 addition: the fold would take a `since` cutoff and
/// this list gains an entry, with no schema or API change.
export const WINDOWS = ["all"] as const;
export type StatsWindow = (typeof WINDOWS)[number];

export interface LiveReader {
  getPerpPosition(positionId: bigint): Promise<{ open: boolean; isLong: boolean; marketId: string; entryPrice: bigint; size: bigint }>;
  getMarkPrice(marketId: string): Promise<bigint>;
}

/// Unrealised PNL of the still-open perp positions, read from the chain at the live mark. The chain, not
/// the event log, is the source for an open position's entry price: a position that was increased has a
/// weighted entry the events do not carry. A market whose mark cannot be read right now (equity session
/// shut, oracle paused) leaves its positions at 0 for this round rather than failing the whole run, and a
/// position the chain says is closed (the indexer is a few blocks behind) is skipped.
export async function priceOpenPositions(
  positionIds: readonly string[],
  reader: LiveReader,
  maxPositions: number,
  warn: (message: string, error?: unknown) => void = () => {},
): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  const marks = new Map<string, bigint | null>();
  const ids = positionIds.slice(0, maxPositions);
  if (positionIds.length > maxPositions) {
    warn(`trader stats: ${positionIds.length} open positions, pricing the first ${maxPositions} (LEADERBOARD_MAX_LIVE_POSITIONS)`);
  }

  for (const id of ids) {
    try {
      const position = await reader.getPerpPosition(BigInt(id));
      if (!position.open) continue;
      if (!marks.has(position.marketId)) {
        try {
          marks.set(position.marketId, await reader.getMarkPrice(position.marketId));
        } catch (error) {
          marks.set(position.marketId, null);
          warn(`trader stats: no mark price for ${position.marketId} this round`, error);
        }
      }
      const mark = marks.get(position.marketId);
      if (mark === null || mark === undefined) continue;
      result.set(id, perpUnrealisedPnl(position.isLong, position.entryPrice, mark, position.size));
    } catch (error) {
      warn(`trader stats: could not read position ${id}`, error);
    }
  }
  return result;
}

export interface JobConfig {
  maxLivePositions: number;
  optionGraceSeconds: number;
}

/// One derivation pass: read the relevant events in chain order, price the open positions, fold, and
/// replace the window's rows in one transaction so a reader never sees a half-written board.
export async function runTraderStats(
  db: Db,
  reader: LiveReader,
  config: JobConfig,
  warn: (message: string, error?: unknown) => void = () => {},
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<number> {
  const rows = await db
    .select({ txHash: events.txHash, eventName: events.eventName, args: events.args })
    .from(events)
    .where(inArray(events.eventName, [...STAT_EVENT_NAMES]))
    .orderBy(asc(events.blockNumber), asc(events.logIndex));
  const eventRows: EventRow[] = rows.map((row) => ({ txHash: row.txHash, eventName: row.eventName, args: row.args as Record<string, unknown> }));

  const unrealisedByPosition = await priceOpenPositions(openPerpPositionIds(eventRows), reader, config.maxLivePositions, warn);
  const stats = foldTraderStats(eventRows, { unrealisedByPosition, nowSeconds, optionGraceSeconds: config.optionGraceSeconds });

  for (const window of WINDOWS) await replaceWindow(db, window, stats);
  return stats.length;
}

const CHUNK = 500;

async function replaceWindow(db: Db, window: StatsWindow, stats: readonly TraderStat[]) {
  await db.transaction(async (tx) => {
    await tx.delete(traderStats).where(eq(traderStats.window, window));
    for (let i = 0; i < stats.length; i += CHUNK) {
      await tx.insert(traderStats).values(
        stats.slice(i, i + CHUNK).map((stat) => ({
          wallet: stat.wallet,
          window,
          realisedPnl: stat.realisedPnl.toString(),
          unrealisedPnl: stat.unrealisedPnl.toString(),
          capitalDeployed: stat.capitalDeployed.toString(),
          roiBps: stat.roiBps.toString(),
          volume: stat.volume.toString(),
          tradeCount: stat.tradeCount,
          closedCount: stat.closedCount,
          winRateBps: stat.winRateBps,
        })),
      );
    }
  });
}
