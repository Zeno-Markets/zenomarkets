import { stringToHex } from "viem";

/// Pure derivation of leaderboard statistics from the indexer's `events` rows. No I/O, so every rule
/// below is unit tested against hand-built event sequences. `traderStatsJob.ts` feeds it rows and
/// writes the result to `trader_stats`.
///
/// The ledger, per wallet, in settlement-token base units:
///   realised PNL  = price PNL of every perp reduction, close and liquidation
///                 + funding received or paid
///                 + option PNL (closed, exercised, or expired worthless)
///                 - fees the wallet paid on perps (TAKER, LIQUIDATION) and on opening options (OPTION_OPEN)
/// Option close and settlement fees are not subtracted again: the contracts already net them out of the
/// `realizedPnl` / payout they emit. The liquidator's 5% reward is not in any event, so it is not here.

export interface EventRow {
  txHash: string;
  eventName: string;
  args: Record<string, unknown>;
}

/// Every event name the fold reads. The job selects only these, so the scan stays small.
export const STAT_EVENT_NAMES = [
  "PerpPositionOpened",
  "PerpPositionUpdated",
  "PerpPositionClosed",
  "PositionLiquidated",
  "FundingPaid",
  "OptionPositionOpened",
  "OptionPositionClosed",
  "OptionExercised",
  "ProtocolFeeCollected",
] as const;

/// The `feeType` values that belong to a wallet's cost of trading and are not already inside an
/// option's own realised PNL. `feeType` is a bytes32 of the ASCII label, left aligned.
const COUNTED_FEE_TYPES = new Set<string>(["TAKER", "LIQUIDATION", "OPTION_OPEN"].map((label) => stringToHex(label, { size: 32 })));

export interface TraderStat {
  wallet: string;
  realisedPnl: bigint;
  unrealisedPnl: bigint;
  capitalDeployed: bigint;
  roiBps: bigint;
  volume: bigint;
  tradeCount: number;
  closedCount: number;
  /// Null until the wallet has closed a position.
  winRateBps: number | null;
}

export interface FoldOptions {
  /// Unrealised PNL of each still-open perp position, by position id. A position the caller could not
  /// price is left out and counts as 0.
  unrealisedByPosition: ReadonlyMap<string, bigint>;
  /// Unix seconds, "now". An option whose expiry plus the grace is before this, and which has no close
  /// or exercise event, expired worthless.
  nowSeconds: number;
  /// How long after expiry the keeper may still settle an in-the-money option before the absence of an
  /// exercise event is read as "worthless".
  optionGraceSeconds: number;
}

interface Account {
  realised: bigint;
  capital: bigint;
  volume: bigint;
  trades: number;
  closed: number;
  wins: number;
}

interface PerpState {
  owner: string;
  size: bigint;
  collateral: bigint;
  /// Price PNL plus funding accrued so far; the win test when the position finishes.
  net: bigint;
  done: boolean;
}

interface OptionState {
  owner: string;
  premium: bigint;
  expiry: number;
  done: boolean;
}

const big = (value: unknown): bigint => BigInt(String(value ?? "0"));
const wallet = (value: unknown): string => String(value ?? "").toLowerCase();

/// `rows` must be in event order (ascending `events.id`): a position's size change is read against its
/// previous event.
export function foldTraderStats(rows: readonly EventRow[], options: FoldOptions): TraderStat[] {
  const accounts = new Map<string, Account>();
  const perps = new Map<string, PerpState>();
  const optionsById = new Map<string, OptionState>();

  const account = (owner: string): Account => {
    let found = accounts.get(owner);
    if (!found) {
      found = { realised: 0n, capital: 0n, volume: 0n, trades: 0, closed: 0, wins: 0 };
      accounts.set(owner, found);
    }
    return found;
  };

  const finish = (acc: Account, profitable: boolean) => {
    acc.closed += 1;
    if (profitable) acc.wins += 1;
  };

  for (const row of rows) {
    const a = row.args;
    switch (row.eventName) {
      case "PerpPositionOpened": {
        const owner = wallet(a.owner);
        const size = big(a.size);
        const collateral = big(a.collateral);
        perps.set(String(a.positionId), { owner, size, collateral, net: 0n, done: false });
        const acc = account(owner);
        acc.volume += size;
        acc.capital += collateral;
        acc.trades += 1;
        break;
      }
      case "PerpPositionUpdated": {
        const state = perps.get(String(a.positionId));
        if (!state || state.done) break;
        const newSize = big(a.newSize);
        const newCollateral = big(a.newCollateral);
        const pnl = big(a.realizedPnlDelta);
        const acc = account(state.owner);
        acc.volume += newSize > state.size ? newSize - state.size : state.size - newSize;
        // Margin added counts as capital deployed; margin released by a reduction does not reduce it.
        if (newCollateral > state.collateral) acc.capital += newCollateral - state.collateral;
        acc.realised += pnl;
        acc.trades += 1;
        state.size = newSize;
        state.collateral = newCollateral;
        state.net += pnl;
        break;
      }
      case "PerpPositionClosed": {
        const state = perps.get(String(a.positionId));
        if (!state || state.done) break;
        const pnl = big(a.realizedPnl);
        const acc = account(state.owner);
        acc.volume += state.size;
        acc.realised += pnl;
        acc.trades += 1;
        state.net += pnl;
        state.done = true;
        finish(acc, state.net > 0n);
        break;
      }
      case "PositionLiquidated": {
        const state = perps.get(String(a.positionId));
        if (!state || state.done) break;
        const pnl = big(a.pnl);
        const acc = account(state.owner);
        acc.volume += state.size;
        acc.realised += pnl;
        acc.trades += 1;
        state.net += pnl;
        state.done = true;
        finish(acc, state.net > 0n);
        break;
      }
      case "FundingPaid": {
        const state = perps.get(String(a.positionId));
        if (!state || state.done) break;
        const amount = big(a.amount);
        account(state.owner).realised += amount;
        state.net += amount;
        break;
      }
      case "OptionPositionOpened": {
        const owner = wallet(a.owner);
        const premium = big(a.premium);
        optionsById.set(String(a.positionId), { owner, premium, expiry: Number(big(a.expiry)), done: false });
        const acc = account(owner);
        acc.volume += premium;
        acc.capital += premium;
        acc.trades += 1;
        break;
      }
      case "OptionPositionClosed": {
        const state = optionsById.get(String(a.positionId));
        if (!state || state.done) break;
        const pnl = big(a.realizedPnl);
        const acc = account(state.owner);
        acc.realised += pnl;
        acc.trades += 1;
        state.done = true;
        finish(acc, pnl > 0n);
        break;
      }
      case "OptionExercised": {
        // Emitted as (positionId, grossPayout, netPayout), the ABI names the last two `intrinsicValue`
        // and `payout`; `payout` is the amount credited after the settlement fee.
        const state = optionsById.get(String(a.positionId));
        if (!state || state.done) break;
        const pnl = big(a.payout) - state.premium;
        const acc = account(state.owner);
        acc.realised += pnl;
        state.done = true;
        finish(acc, pnl > 0n);
        break;
      }
      case "ProtocolFeeCollected": {
        if (!COUNTED_FEE_TYPES.has(String(a.feeType).toLowerCase())) break;
        account(wallet(a.payer)).realised -= big(a.amount);
        break;
      }
      default:
        break;
    }
  }

  // An option past expiry plus the grace with no close or exercise settled for nothing: the premium is lost.
  for (const state of optionsById.values()) {
    if (state.done || state.expiry + options.optionGraceSeconds >= options.nowSeconds) continue;
    const acc = account(state.owner);
    acc.realised -= state.premium;
    finish(acc, false);
  }

  const unrealisedByWallet = new Map<string, bigint>();
  for (const [positionId, unrealised] of options.unrealisedByPosition) {
    const state = perps.get(positionId);
    if (!state || state.done) continue;
    unrealisedByWallet.set(state.owner, (unrealisedByWallet.get(state.owner) ?? 0n) + unrealised);
  }

  const stats: TraderStat[] = [];
  for (const [owner, acc] of accounts) {
    // A wallet that was only ever charged a fee (no trade) is not a trader.
    if (acc.trades === 0) continue;
    const unrealised = unrealisedByWallet.get(owner) ?? 0n;
    stats.push({
      wallet: owner,
      realisedPnl: acc.realised,
      unrealisedPnl: unrealised,
      capitalDeployed: acc.capital,
      roiBps: roiBps(acc.realised + unrealised, acc.capital),
      volume: acc.volume,
      tradeCount: acc.trades,
      closedCount: acc.closed,
      winRateBps: acc.closed === 0 ? null : Math.floor((acc.wins * 10_000) / acc.closed),
    });
  }
  return stats.sort((x, y) => (x.wallet < y.wallet ? -1 : 1));
}

/// Return on deployed capital in basis points, rounded toward zero. 0 with no capital.
export function roiBps(totalPnl: bigint, capital: bigint): bigint {
  return capital === 0n ? 0n : (totalPnl * 10_000n) / capital;
}

/// The same signed PNL formula `MarginEngine.unrealizedPnl` uses on chain: the position's notional times
/// the price move over the entry price, truncated toward zero. Prices are 18-decimal, `size` is notional.
export function perpUnrealisedPnl(isLong: boolean, entryPrice: bigint, markPrice: bigint, size: bigint): bigint {
  if (entryPrice === 0n) return 0n;
  const delta = isLong ? markPrice - entryPrice : entryPrice - markPrice;
  return (size * delta) / entryPrice;
}

/// Position ids that were opened and never closed or liquidated, by the event log alone. The job prices
/// these against the chain.
export function openPerpPositionIds(rows: readonly EventRow[]): string[] {
  const open = new Set<string>();
  for (const row of rows) {
    const id = String(row.args.positionId);
    if (row.eventName === "PerpPositionOpened") open.add(id);
    else if (row.eventName === "PerpPositionClosed" || row.eventName === "PositionLiquidated") open.delete(id);
  }
  return [...open];
}

/// Per perp position, price PNL plus funding as the event log records it. The chain keeps the same two
/// sums per position (`realizedPnl` and `fundingAccrued`), so this is what `reconcile.ts` compares.
export function perpNetByPosition(rows: readonly EventRow[]): Map<string, { owner: string; net: bigint }> {
  const positions = new Map<string, { owner: string; net: bigint }>();
  for (const row of rows) {
    const a = row.args;
    const id = String(a.positionId);
    if (row.eventName === "PerpPositionOpened") {
      positions.set(id, { owner: wallet(a.owner), net: 0n });
      continue;
    }
    const state = positions.get(id);
    if (!state) continue;
    if (row.eventName === "PerpPositionUpdated") state.net += big(a.realizedPnlDelta);
    else if (row.eventName === "PerpPositionClosed") state.net += big(a.realizedPnl);
    else if (row.eventName === "PositionLiquidated") state.net += big(a.pnl);
    else if (row.eventName === "FundingPaid") state.net += big(a.amount);
  }
  return positions;
}
