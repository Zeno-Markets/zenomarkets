import { keccak256, recoverMessageAddress, toBytes } from "viem";

/// Pure helpers for `routes/leaderboard.ts`, kept free of I/O so they can be unit tested. Everything the
/// leaderboard and the PNL card show is derived from what `services/indexer` recorded plus a chain read
/// for open positions: display data, never an input to margin, liquidation or settlement.

export const METRICS = ["pnl", "roi", "volume"] as const;
export type Metric = (typeof METRICS)[number];

/// Launch ships `all` only. `24h` is a Phase 18 addition: add it here and in the indexer's `WINDOWS`,
/// and no route, shape or client changes.
export const WINDOWS = ["all"] as const;
export type StatsWindow = (typeof WINDOWS)[number];

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface BoardQuery {
  metric: Metric;
  window: StatsWindow;
  limit: number;
  offset: number;
  sample: boolean;
}

/// Parses the query string, or returns the one message to put in a `400`.
export function parseBoardQuery(query: Record<string, string | undefined>): BoardQuery | { error: string } {
  const metric = query.metric ?? "pnl";
  if (!(METRICS as readonly string[]).includes(metric)) return { error: `metric must be one of ${METRICS.join(", ")}` };
  const window = query.window ?? "all";
  if (!(WINDOWS as readonly string[]).includes(window)) return { error: `window must be one of ${WINDOWS.join(", ")}` };
  const limit = query.limit === undefined ? DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: `limit must be a whole number from 1 to ${MAX_LIMIT}` };
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) return { error: "offset must be a whole number, 0 or more" };
  if (query.sample !== undefined && query.sample !== "1") return { error: "sample must be 1 when given" };
  return { metric: metric as Metric, window: window as StatsWindow, limit, offset, sample: query.sample === "1" };
}

/// Lowercase addresses from a comma-separated environment value (`SAMPLE_WALLETS`): the simulator's bot wallets.
export function parseWalletList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => ADDRESS.test(entry));
}

export interface BoardEntry {
  rank: number;
  wallet: string;
  realisedPnl: string;
  unrealisedPnl: string;
  totalPnl: string;
  roiBps: string;
  volume: string;
  tradeCount: number;
  winRateBps: number | null;
  sample: boolean;
}

export interface BoardResponse {
  metric: Metric;
  window: StatsWindow;
  sample: boolean;
  updatedAt: string | null;
  settlementDecimals: number;
  total: number;
  limit: number;
  offset: number;
  entries: BoardEntry[];
}

/// What `trader_stats` rows look like once the API's camel-casing client has read them.
export interface StatsRow {
  wallet: string;
  realisedPnl: string;
  unrealisedPnl: string;
  totalPnl: string;
  roiBps: string;
  volume: string;
  tradeCount: number;
  winRateBps: number | null;
}

export function entriesFromRows(rows: readonly StatsRow[], offset: number, sampleWallets: ReadonlySet<string>): BoardEntry[] {
  return rows.map((row, index) => ({
    rank: offset + index + 1,
    wallet: row.wallet,
    realisedPnl: row.realisedPnl,
    unrealisedPnl: row.unrealisedPnl,
    totalPnl: row.totalPnl,
    roiBps: row.roiBps,
    volume: row.volume,
    tradeCount: row.tradeCount,
    winRateBps: row.winRateBps,
    sample: sampleWallets.has(row.wallet),
  }));
}

const metricValue = (row: StatsRow, metric: Metric): bigint =>
  BigInt(metric === "pnl" ? row.totalPnl : metric === "roi" ? row.roiBps : row.volume);

/// The ordering the SQL applies, for the synthetic board: metric descending, then volume descending, then
/// wallet ascending. Numeric, never textual.
export function compareRows(metric: Metric) {
  return (a: StatsRow, b: StatsRow): number => {
    const byMetric = metricValue(b, metric) - metricValue(a, metric);
    if (byMetric !== 0n) return byMetric > 0n ? 1 : -1;
    const byVolume = BigInt(b.volume) - BigInt(a.volume);
    if (byVolume !== 0n) return byVolume > 0n ? 1 : -1;
    return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  };
}

const usd = (dollars: number, cents = 0) => BigInt(dollars) * 1_000_000n + BigInt(cents) * 10_000n;

/// One synthetic trader: the figures that go in, from which the rest of the row is worked out.
/// Dollars are whole numbers; `capital` is what the ROI is measured against.
interface Fixture {
  label: string;
  realised: bigint;
  unrealised: bigint;
  capital: bigint;
  volume: bigint;
  trades: number;
  winRateBps: number;
}

/// The fixed fallback board, for launch day when nobody has traded yet and the simulator is not running.
/// The wallets are derived from a label and are not controlled by anyone. Twelve rows with a spread of
/// winners and losers, so every metric has a visibly different order.
const FIXTURES: readonly Fixture[] = [
  { label: "whale-1", realised: usd(48_200), unrealised: usd(3_100), capital: usd(250_000), volume: usd(2_400_000), trades: 38, winRateBps: 6100 },
  { label: "whale-2", realised: usd(31_750), unrealised: usd(-4_400), capital: usd(300_000), volume: usd(3_100_000), trades: 52, winRateBps: 5300 },
  { label: "scalper-1", realised: usd(9_820), unrealised: usd(120), capital: usd(12_000), volume: usd(1_150_000), trades: 412, winRateBps: 5800 },
  { label: "scalper-2", realised: usd(6_240), unrealised: usd(-310), capital: usd(9_000), volume: usd(980_000), trades: 377, winRateBps: 5400 },
  { label: "scalper-3", realised: usd(2_105), unrealised: usd(40), capital: usd(8_000), volume: usd(760_000), trades: 301, winRateBps: 5100 },
  { label: "trend-1", realised: usd(14_900), unrealised: usd(5_050), capital: usd(40_000), volume: usd(410_000), trades: 64, winRateBps: 5900 },
  { label: "trend-2", realised: usd(-3_800), unrealised: usd(900), capital: usd(35_000), volume: usd(365_000), trades: 71, winRateBps: 4300 },
  { label: "contrarian-1", realised: usd(1_150), unrealised: usd(-220), capital: usd(6_000), volume: usd(122_000), trades: 29, winRateBps: 5000 },
  { label: "degen-long", realised: usd(21_300), unrealised: usd(-1_800), capital: usd(2_500), volume: usd(260_000), trades: 17, winRateBps: 4700 },
  { label: "degen-short", realised: usd(-2_450), unrealised: usd(-120), capital: usd(2_000), volume: usd(190_000), trades: 22, winRateBps: 3600 },
  { label: "swing-1", realised: usd(4_480), unrealised: usd(260), capital: usd(18_000), volume: usd(210_000), trades: 26, winRateBps: 6200 },
  { label: "swing-2", realised: usd(-760), unrealised: usd(0), capital: usd(5_000), volume: usd(64_000), trades: 9, winRateBps: 4400 },
];

function fixtureWallet(label: string): string {
  return `0x${keccak256(toBytes(`zeno-sample-leaderboard:${label}`)).slice(2, 42)}`;
}

function fixtureRow(fixture: Fixture): StatsRow {
  const total = fixture.realised + fixture.unrealised;
  return {
    wallet: fixtureWallet(fixture.label),
    realisedPnl: fixture.realised.toString(),
    unrealisedPnl: fixture.unrealised.toString(),
    totalPnl: total.toString(),
    roiBps: ((total * 10_000n) / fixture.capital).toString(),
    volume: fixture.volume.toString(),
    tradeCount: fixture.trades,
    winRateBps: fixture.winRateBps,
  };
}

/// The synthetic board, ranked for `metric` and cut to one page. Always labelled `sample`.
export function syntheticBoard(query: BoardQuery, settlementDecimals: number): BoardResponse {
  const rows = FIXTURES.map(fixtureRow).sort(compareRows(query.metric));
  const page = rows.slice(query.offset, query.offset + query.limit);
  const entries = entriesFromRows(page, query.offset, new Set(page.map((row) => row.wallet)));
  return {
    metric: query.metric,
    window: query.window,
    sample: true,
    updatedAt: null,
    settlementDecimals,
    total: rows.length,
    limit: query.limit,
    offset: query.offset,
    entries,
  };
}

// --- Privacy opt-out ----------------------------------------------------------------------------

/// A signature is only good for this long around its stated time, so a captured one cannot be replayed later.
export const VISIBILITY_WINDOW_SECONDS = 600;

/// The exact text the wallet signs. The frontend shows it at the review step before asking for the signature.
export function visibilityMessage(wallet: string, hidden: boolean, issuedAt: number): string {
  return `Zeno leaderboard visibility\nWallet: ${wallet.toLowerCase()}\nHidden: ${hidden}\nIssued: ${issuedAt}`;
}

export interface VisibilityRequest {
  wallet: string;
  hidden: boolean;
  issuedAt: number;
  signature: `0x${string}`;
}

export function parseVisibilityBody(body: unknown): VisibilityRequest | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "body must be a JSON object" };
  const { wallet, hidden, issuedAt, signature } = body as Record<string, unknown>;
  if (typeof wallet !== "string" || !ADDRESS.test(wallet)) return { error: "wallet must be an address" };
  if (typeof hidden !== "boolean") return { error: "hidden must be true or false" };
  if (typeof issuedAt !== "number" || !Number.isInteger(issuedAt) || issuedAt <= 0) return { error: "issuedAt must be unix seconds" };
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return { error: "signature must be a hex string" };
  return { wallet: wallet.toLowerCase(), hidden, issuedAt, signature: signature as `0x${string}` };
}

/// True when `signature` is the wallet's EIP-191 signature over the visibility message. A signature that
/// does not parse at all counts as a bad one.
export async function signatureMatches(request: VisibilityRequest): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message: visibilityMessage(request.wallet, request.hidden, request.issuedAt),
      signature: request.signature,
    });
    return recovered.toLowerCase() === request.wallet;
  } catch {
    return false;
  }
}

// --- PNL card -----------------------------------------------------------------------------------

export interface OpenedEvent {
  owner: string;
  marketId: string;
  isLong: boolean;
  size: string;
  collateral: string;
  leverage: string;
  createdAt: Date;
  txHash: string;
}

/// A later event of the same position, in chain order.
export interface PositionEvent {
  eventName: string;
  txHash: string;
  args: Record<string, unknown>;
  createdAt: Date;
}

/// What the chain says now. `entryPrice` is the weighted entry, which the events do not carry once a
/// position has been increased.
export interface ChainPosition {
  open: boolean;
  entryPrice: bigint;
  size: bigint;
  collateral: bigint;
}

export interface PnlCard {
  wallet: string;
  positionId: string;
  kind: "perp";
  marketId: string;
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed" | "liquidated";
  leverage: number;
  size: string;
  collateral: string;
  entryPrice: string;
  exitPrice: string | null;
  markPrice: string | null;
  pricePnl: string;
  fundingPnl: string;
  fees: string;
  unrealisedPnl: string | null;
  totalPnl: string;
  roiBps: string;
  openedAt: string;
  closedAt: string | null;
  settlementDecimals: number;
  sample: boolean;
}

/// "NVDA" from the market id, which is the symbol's ASCII bytes padded with zeros to 32 bytes.
export function symbolOfMarketId(marketId: string): string {
  return Buffer.from(marketId.slice(2), "hex").toString("utf8").replace(/\0+$/, "");
}

/// The same signed formula `MarginEngine.unrealizedPnl` uses on chain, truncating toward zero.
export function perpUnrealisedPnl(isLong: boolean, entryPrice: bigint, markPrice: bigint, size: bigint): bigint {
  if (entryPrice === 0n) return 0n;
  const delta = isLong ? markPrice - entryPrice : entryPrice - markPrice;
  return (size * delta) / entryPrice;
}

const big = (value: unknown): bigint => BigInt(String(value ?? "0"));

export interface CardInput {
  wallet: string;
  positionId: string;
  opened: OpenedEvent;
  later: readonly PositionEvent[];
  /// Taker and liquidation fees the owner paid in this position's own transactions, a non-negative magnitude.
  fees: bigint;
  chain: ChainPosition;
  /// The live mark for an open position, or null when it cannot be read right now.
  markPrice: bigint | null;
  settlementDecimals: number;
  sample: boolean;
}

export function buildPnlCard(input: CardInput): PnlCard {
  const { opened, later, chain } = input;

  let pricePnl = 0n;
  let fundingPnl = 0n;
  let capital = big(opened.collateral);
  let collateral = big(opened.collateral);
  let size = big(opened.size);
  let liquidated = false;
  let closed = false;
  let closedAt: Date | null = null;
  let exitPrice: bigint | null = null;

  for (const event of later) {
    const a = event.args;
    if (event.eventName === "FundingPaid") {
      fundingPnl += big(a.amount);
    } else if (event.eventName === "PerpPositionUpdated") {
      const newCollateral = big(a.newCollateral);
      if (newCollateral > collateral) capital += newCollateral - collateral;
      collateral = newCollateral;
      size = big(a.newSize);
      pricePnl += big(a.realizedPnlDelta);
    } else if (event.eventName === "PerpPositionClosed") {
      const pnl = big(a.realizedPnl);
      pricePnl += pnl;
      closed = true;
      closedAt = event.createdAt;
      // The close event has no price. Invert PNL = size * (exit - entry) / entry for the closing slice.
      if (size > 0n) exitPrice = chain.entryPrice + ((opened.isLong ? 1n : -1n) * pnl * chain.entryPrice) / size;
    } else if (event.eventName === "PositionLiquidated") {
      pricePnl += big(a.pnl);
      liquidated = true;
      closedAt = event.createdAt;
      exitPrice = big(a.markPriceAtLiquidation);
    }
  }

  const status: PnlCard["status"] = liquidated ? "liquidated" : closed || !chain.open ? "closed" : "open";
  const isOpen = status === "open";
  const unrealised = isOpen && input.markPrice !== null ? perpUnrealisedPnl(opened.isLong, chain.entryPrice, input.markPrice, chain.size) : null;
  const total = pricePnl + fundingPnl - input.fees + (unrealised ?? 0n);

  return {
    wallet: input.wallet,
    positionId: input.positionId,
    kind: "perp",
    marketId: opened.marketId,
    symbol: symbolOfMarketId(opened.marketId),
    side: opened.isLong ? "long" : "short",
    status,
    leverage: Number(opened.leverage),
    size: chain.size.toString(),
    collateral: chain.collateral.toString(),
    entryPrice: chain.entryPrice.toString(),
    exitPrice: isOpen ? null : exitPrice === null ? null : exitPrice.toString(),
    markPrice: isOpen && input.markPrice !== null ? input.markPrice.toString() : null,
    pricePnl: pricePnl.toString(),
    fundingPnl: fundingPnl.toString(),
    fees: input.fees.toString(),
    unrealisedPnl: isOpen ? (unrealised === null ? null : unrealised.toString()) : "0",
    totalPnl: total.toString(),
    roiBps: (capital === 0n ? 0n : (total * 10_000n) / capital).toString(),
    openedAt: opened.createdAt.toISOString(),
    closedAt: closedAt === null ? null : closedAt.toISOString(),
    settlementDecimals: input.settlementDecimals,
    sample: input.sample,
  };
}
