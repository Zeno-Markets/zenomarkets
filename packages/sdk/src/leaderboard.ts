import { ZenoError, NotImplementedError } from "./errors.js";

/// The leaderboard and the PNL card, from `services/api` (`GET /v1/leaderboard`,
/// `GET /v1/pnl-card/:wallet/:positionId`). Both derive from the indexer's event log, so they are
/// display data only and nothing that settles money reads them.
///
/// The wire format is the one the backend lane published in `docs/evidence/phase-10.md`: every amount a
/// decimal string of an integer, which this module restores to `bigint`. Money is in settlement-token
/// base units, prices are 18-decimal, ratios are basis points.

export type LeaderboardMetric = "pnl" | "roi" | "volume";

export interface LeaderboardEntry {
  /// 1-based and unique: ties never share a rank.
  rank: number;
  wallet: string;
  realisedPnl: bigint;
  unrealisedPnl: bigint;
  totalPnl: bigint;
  /// Total PNL over capital deployed, signed, in basis points.
  roiBps: bigint;
  volume: bigint;
  tradeCount: number;
  /// Share of closed positions that ended in profit, 0 to 10000. `null` when none has closed.
  winRateBps: number | null;
  /// This wallet is a simulator bot, so the row carries the `SAMPLE DATA` mark.
  sample: boolean;
}

export interface Leaderboard {
  metric: LeaderboardMetric;
  window: "all";
  /// Every row is simulated. Drives the label on the whole board.
  sample: boolean;
  /// When the indexer last wrote the stats. `null` when it has never run.
  updatedAt: string | null;
  settlementDecimals: number;
  total: number;
  limit: number;
  offset: number;
  entries: LeaderboardEntry[];
}

export interface LeaderboardQuery {
  metric?: LeaderboardMetric;
  limit?: number;
  offset?: number;
  /// Ask for the simulator board.
  sample?: boolean;
}

export type PnlCardStatus = "open" | "closed" | "liquidated";

export interface PnlCard {
  wallet: string;
  positionId: bigint;
  kind: "perp";
  marketId: string;
  /// The ticker, without `-PERP`.
  symbol: string;
  side: "long" | "short";
  status: PnlCardStatus;
  leverage: number;
  size: bigint;
  collateral: bigint;
  entryPrice: bigint;
  /// `null` while open.
  exitPrice: bigint | null;
  /// `null` once closed, or while open with no price (session shut or market paused).
  markPrice: bigint | null;
  pricePnl: bigint;
  fundingPnl: bigint;
  /// A non-negative magnitude, already subtracted in `totalPnl`.
  fees: bigint;
  unrealisedPnl: bigint | null;
  /// The headline number: `pricePnl + fundingPnl - fees + (unrealisedPnl ?? 0)`.
  totalPnl: bigint;
  roiBps: bigint;
  openedAt: string;
  closedAt: string | null;
  settlementDecimals: number;
  sample: boolean;
}

/// A non-success answer from the API, with the status so a screen can tell "not found" from "down".
export class LeaderboardHttpError extends ZenoError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LeaderboardNamespace {
  /// The board. Requires `apiUrl`.
  board(query?: LeaderboardQuery): Promise<Leaderboard>;
  /// One position's card. Requires `apiUrl`. A `404` is `LeaderboardHttpError` with `status` 404: the
  /// position does not exist, is another wallet's, or its owner opted out, and the API does not say which.
  pnlCard(wallet: string, positionId: bigint | string): Promise<PnlCard>;
}

type Wire = Record<string, unknown>;
const big = (value: unknown): bigint => BigInt(String(value));
const bigOrNull = (value: unknown): bigint | null => (value === null || value === undefined ? null : BigInt(String(value)));

export function parseLeaderboard(body: Wire): Leaderboard {
  const entries = (body.entries as Wire[]).map(
    (row): LeaderboardEntry => ({
      rank: Number(row.rank),
      wallet: String(row.wallet),
      realisedPnl: big(row.realisedPnl),
      unrealisedPnl: big(row.unrealisedPnl),
      totalPnl: big(row.totalPnl),
      roiBps: big(row.roiBps),
      volume: big(row.volume),
      tradeCount: Number(row.tradeCount),
      winRateBps: row.winRateBps === null || row.winRateBps === undefined ? null : Number(row.winRateBps),
      sample: Boolean(row.sample),
    }),
  );
  return {
    metric: body.metric as LeaderboardMetric,
    window: "all",
    sample: Boolean(body.sample),
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
    settlementDecimals: Number(body.settlementDecimals),
    total: Number(body.total),
    limit: Number(body.limit),
    offset: Number(body.offset),
    entries,
  };
}

export function parsePnlCard(body: Wire): PnlCard {
  return {
    wallet: String(body.wallet),
    positionId: big(body.positionId),
    kind: "perp",
    marketId: String(body.marketId),
    symbol: String(body.symbol),
    side: body.side === "short" ? "short" : "long",
    status: body.status as PnlCardStatus,
    leverage: Number(body.leverage),
    size: big(body.size),
    collateral: big(body.collateral),
    entryPrice: big(body.entryPrice),
    exitPrice: bigOrNull(body.exitPrice),
    markPrice: bigOrNull(body.markPrice),
    pricePnl: big(body.pricePnl),
    fundingPnl: big(body.fundingPnl),
    fees: big(body.fees),
    unrealisedPnl: bigOrNull(body.unrealisedPnl),
    totalPnl: big(body.totalPnl),
    roiBps: big(body.roiBps),
    openedAt: String(body.openedAt),
    closedAt: typeof body.closedAt === "string" ? body.closedAt : null,
    settlementDecimals: Number(body.settlementDecimals),
    sample: Boolean(body.sample),
  };
}

export function createLeaderboard(apiUrl: string | undefined): LeaderboardNamespace {
  async function get(method: string, path: string): Promise<Wire> {
    if (!apiUrl) throw new NotImplementedError(method, "requires `apiUrl` in the Zeno constructor config, pointing at services/api");
    const response = await fetch(`${apiUrl}${path}`);
    if (!response.ok) throw new LeaderboardHttpError(response.status, `${method}: services/api returned ${response.status}`);
    return (await response.json()) as Wire;
  }

  return {
    async board(query = {}) {
      const params = new URLSearchParams({ metric: query.metric ?? "pnl", window: "all" });
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      if (query.offset !== undefined) params.set("offset", String(query.offset));
      if (query.sample) params.set("sample", "1");
      return parseLeaderboard(await get("leaderboard.board", `/v1/leaderboard?${params}`));
    },
    async pnlCard(wallet, positionId) {
      return parsePnlCard(await get("leaderboard.pnlCard", `/v1/pnl-card/${wallet.toLowerCase()}/${positionId}`));
    },
  };
}
