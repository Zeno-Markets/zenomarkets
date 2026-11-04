import { ZenoContractError, perpPositionManagerAbi, type Zeno } from "@zeno/sdk";
import type { Address, PerpPosition } from "@zeno/types";
import type { Sql } from "postgres";
import type { PublicClient } from "viem";

/// The copy trading executor (`docs/COPY_TRADING.md`). Each pass it reads the active follows, looks at the
/// leader's perp positions, and mirrors them into the follower's copy subaccount:
///
/// - a leader position opened after the follow began is opened in the subaccount at the leader's leverage, with
///   the follower's margin in the same proportion as the leader's margin is to the leader's balance;
/// - a mirrored position is closed when the leader's closes;
/// - a trade that would break one of the follower's caps, or that the chain refuses, is recorded as a skip with a
///   plain reason. Nothing is ever opened in part.
///
/// The executor's key can trade in the subaccount and can do nothing else: `Subaccount` lets a delegate call the
/// engines only, so it cannot withdraw. The follower revokes it on chain at any time; the delegate check runs on
/// every pass, and stopping a follow in the API takes effect at once.

export interface Follow {
  id: number;
  follower: string;
  leader: string;
  subaccount: string;
  maxTradeSize: bigint;
  maxExposure: bigint;
  maxLeverage: number;
  markets: string[] | null;
}

export interface LeaderTrade {
  market: string;
  collateral: bigint;
  leverage: bigint;
}

export type Decision = { action: "open"; collateral: bigint; leverage: bigint; size: bigint } | { action: "skip"; reason: string };

/// Whether and how to mirror one leader trade. Pure: every limit is checked here, so the reason a trade was
/// skipped is the first cap it broke and a test can hold each one.
export function decide(input: {
  trade: LeaderTrade;
  follow: Pick<Follow, "maxTradeSize" | "maxExposure" | "maxLeverage" | "markets">;
  leaderBalance: bigint;
  followerBalance: bigint;
  followerAvailable: bigint;
  /// Notional the follower already has open through this follow.
  openExposure: bigint;
}): Decision {
  const { trade, follow } = input;
  if (follow.markets && !follow.markets.includes(trade.market)) return { action: "skip", reason: `${trade.market} is not one of the markets you chose to copy.` };
  if (trade.leverage > BigInt(follow.maxLeverage)) return { action: "skip", reason: `The leader used ${trade.leverage}x, over your ${follow.maxLeverage}x limit.` };
  if (input.leaderBalance <= 0n) return { action: "skip", reason: "The leader's balance could not be read, so the trade could not be sized." };
  const collateral = (trade.collateral * input.followerBalance) / input.leaderBalance;
  if (collateral <= 0n) return { action: "skip", reason: "Your copy account is too small for this trade in proportion to the leader." };
  const size = collateral * trade.leverage;
  if (size > follow.maxTradeSize) return { action: "skip", reason: "This trade is larger than your size limit per trade." };
  if (input.openExposure + size > follow.maxExposure) return { action: "skip", reason: "This trade would take you over your total exposure limit." };
  if (collateral > input.followerAvailable) return { action: "skip", reason: "Not enough free margin in your copy account." };
  return { action: "open", collateral, leverage: trade.leverage, size };
}

/// A plain sentence for a contract error the chain raised. Anything unlisted is a generic refusal: the raw name
/// never leaves this service.
const REFUSALS: Record<string, string> = {
  InsufficientMargin: "Not enough margin in your copy account.",
  InsufficientCollateral: "Not enough free margin in your copy account.",
  MarketPaused: "The market is paused.",
  MarketOraclePaused: "The market is paused.",
  MarketSessionClosed: "The market is closed for the session.",
  NoPriceSource: "The market has no price right now.",
  StaleOraclePrice: "The market's price is out of date.",
  NetOpenInterestLimitExceeded: "The market is at its limit for this side.",
  PositionSizeExceeded: "The trade is over the market's size limit.",
  SlippageExceeded: "The price moved too far to fill.",
};
export const refusalReason = (errorName: string) => REFUSALS[errorName] ?? "The chain refused this trade.";

export interface CopyDeps {
  /// Built with the executor's account: it signs the trades.
  zeno: Zeno;
  publicClient: Pick<PublicClient, "readContract">;
  sql: Sql;
  executor: Address;
  log?: (message: string) => void;
}

export interface CopyExecutor {
  tick(): Promise<{ opened: number; closed: number; skipped: number }>;
}

const symbolOf = (marketId: string) => Buffer.from(marketId.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

export function createCopyExecutor(deps: CopyDeps): CopyExecutor {
  const { zeno, publicClient, sql, executor } = deps;
  const log = deps.log ?? (() => {});
  const managerAddress = zeno.addresses.perpPositionManager;

  const idsOf = (user: Address) => publicClient.readContract({ address: managerAddress, abi: perpPositionManagerAbi, functionName: "getUserPositions", args: [user] });
  const read = async (id: bigint): Promise<PerpPosition> => {
    const position = await publicClient.readContract({ address: managerAddress, abi: perpPositionManagerAbi, functionName: "getPosition", args: [id] });
    return { positionId: id, ...position } as PerpPosition;
  };

  async function pass(follow: Follow, counts: { opened: number; closed: number; skipped: number }) {
    const sub = follow.subaccount as Address;
    const leader = follow.leader as Address;
    // The follower's authorisation, checked on chain every pass.
    if (!(await zeno.subaccounts.isDelegate(sub, executor))) {
      log(`copy: follow ${follow.id}: the executor is not a delegate of ${sub}, so nothing is copied`);
      return;
    }

    const known = new Map<string, { id: number; status: string; followerPositionId: string | null; followerSize: string | null }>();
    for (const row of await sql`select id, leader_position_id, status, follower_position_id, follower_size from copy_executions where follow_id = ${follow.id}`) {
      known.set(row.leader_position_id as string, { id: row.id as number, status: row.status as string, followerPositionId: row.follower_position_id as string | null, followerSize: row.follower_size as string | null });
    }
    // An open that was interrupted between sending and recording is never retried: it could double the position.
    for (const [leaderId, e] of known) {
      if (e.status === "opening") {
        await sql`update copy_executions set status = 'failed', reason = 'This copy was interrupted. Check your copy account for the position.', updated_at = now() where id = ${e.id}`;
        known.set(leaderId, { ...e, status: "failed" });
      }
    }

    const leaderIds = await idsOf(leader);

    // Closes first: a mirrored position whose leader position has closed.
    for (const [leaderId, e] of known) {
      if (e.status !== "open" || !e.followerPositionId) continue;
      const leaderPosition = await read(BigInt(leaderId));
      if (leaderPosition.open) continue;
      const mine = await read(BigInt(e.followerPositionId));
      if (!mine.open) {
        await sql`update copy_executions set status = 'closed', reason = 'Already closed in your copy account.', updated_at = now() where id = ${e.id}`;
        continue;
      }
      try {
        const call = await zeno.trading.prepareClosePerp(mine.positionId, { market: symbolOf(mine.marketId), side: mine.isLong ? "LONG" : "SHORT" });
        const hash = await zeno.subaccounts.execute(sub, call, { wait: true });
        await sql`update copy_executions set status = 'closed', close_tx = ${hash}, updated_at = now() where id = ${e.id}`;
        counts.closed++;
        log(`copy: follow ${follow.id}: closed ${symbolOf(mine.marketId)} #${mine.positionId}`);
      } catch (error) {
        // Still open; the next pass tries again.
        log(`copy: follow ${follow.id}: close of #${mine.positionId} failed: ${describe(error)}`);
      }
    }

    // Opens: leader positions the follow has not seen yet.
    for (const id of leaderIds) {
      if (known.has(id.toString())) continue;
      const position = await read(id);
      const market = symbolOf(position.marketId);
      if (!position.open) {
        // Opened and closed between two passes, or older than the follow: never copied.
        await sql`
          insert into copy_executions (follow_id, leader_position_id, status, reason, market, is_long, leader_size)
          values (${follow.id}, ${id.toString()}, 'existing', 'Closed before it could be copied.', ${market}, ${position.isLong}, ${position.size.toString()})
          on conflict (follow_id, leader_position_id) do nothing`;
        continue;
      }
      const [{ exposure }] = await sql`select coalesce(sum(follower_size::numeric), 0)::text as exposure from copy_executions where follow_id = ${follow.id} and status = 'open'`;
      const [leaderBalances, followerBalances] = await Promise.all([zeno.vault.balances(leader, zeno.addresses.settlementToken), zeno.subaccounts.balances(sub)]);
      const decision = decide({
        trade: { market, collateral: position.collateral, leverage: position.leverage },
        follow,
        leaderBalance: leaderBalances.balance,
        followerBalance: followerBalances.balance,
        followerAvailable: followerBalances.available,
        openExposure: BigInt(String(exposure).split(".")[0] ?? "0"),
      });
      const base = { followId: follow.id, leaderId: id.toString(), market, isLong: position.isLong, leaderSize: position.size.toString() };
      if (decision.action === "skip") {
        await recordSkip(base, decision.reason);
        counts.skipped++;
        log(`copy: follow ${follow.id}: skipped ${market} #${id}: ${decision.reason}`);
        continue;
      }

      const [claimed] = await sql`
        insert into copy_executions (follow_id, leader_position_id, status, market, is_long, leader_size, follower_size)
        values (${base.followId}, ${base.leaderId}, 'opening', ${market}, ${position.isLong}, ${base.leaderSize}, ${decision.size.toString()})
        on conflict (follow_id, leader_position_id) do nothing returning id`;
      if (!claimed) continue;
      try {
        const before = new Set((await idsOf(sub)).map(String));
        const call = await zeno.trading.prepareOpenPerp({ market, side: position.isLong ? "LONG" : "SHORT", collateral: decision.collateral, leverage: decision.leverage });
        const hash = await zeno.subaccounts.execute(sub, call, { wait: true });
        const created = (await idsOf(sub)).map(String).filter((x) => !before.has(x));
        await sql`update copy_executions set status = 'open', follower_position_id = ${created[0] ?? null}, open_tx = ${hash}, updated_at = now() where id = ${claimed.id}`;
        counts.opened++;
        log(`copy: follow ${follow.id}: opened ${market} ${position.isLong ? "long" : "short"} (follower #${created[0] ?? "?"}) for leader #${id}`);
      } catch (error) {
        const reason = error instanceof ZenoContractError ? refusalReason(error.errorName) : "The trade could not be sent. It was not retried.";
        await sql`update copy_executions set status = 'skipped', reason = ${reason}, updated_at = now() where id = ${claimed.id}`;
        counts.skipped++;
        log(`copy: follow ${follow.id}: ${market} #${id} not opened: ${describe(error)}`);
      }
    }
  }

  async function recordSkip(base: { followId: number; leaderId: string; market: string; isLong: boolean; leaderSize: string }, reason: string) {
    await sql`
      insert into copy_executions (follow_id, leader_position_id, status, reason, market, is_long, leader_size)
      values (${base.followId}, ${base.leaderId}, 'skipped', ${reason}, ${base.market}, ${base.isLong}, ${base.leaderSize})
      on conflict (follow_id, leader_position_id) do nothing`;
  }

  return {
    async tick() {
      const counts = { opened: 0, closed: 0, skipped: 0 };
      const rows = await sql`select id, follower, leader, subaccount, max_trade_size, max_exposure, max_leverage, markets from copy_follows where active`;
      for (const row of rows) {
        const follow: Follow = {
          id: row.id as number,
          follower: row.follower as string,
          leader: row.leader as string,
          subaccount: row.subaccount as string,
          maxTradeSize: BigInt(row.max_trade_size as string),
          maxExposure: BigInt(row.max_exposure as string),
          maxLeverage: row.max_leverage as number,
          markets: (row.markets as string[] | null) ?? null,
        };
        try {
          await pass(follow, counts);
        } catch (error) {
          log(`copy: follow ${follow.id} failed this pass: ${describe(error)}`);
        }
      }
      return counts;
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof ZenoContractError) return error.errorName;
  const { shortMessage, message } = error as { shortMessage?: string; message?: string };
  return shortMessage ?? message?.split("\n")[0] ?? String(error);
}
