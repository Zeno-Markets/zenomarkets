import { loadDotEnv } from "@zeno/config";
loadDotEnv();

import { requireEnv, resolveAddresses, resolveChainId } from "@zeno/config";
import { Zeno } from "@zeno/sdk";
import { asc, inArray } from "drizzle-orm";
import { http } from "viem";
import { getDb, getSql } from "./db/client.js";
import { events } from "./db/schema.js";
import { perpNetByPosition, STAT_EVENT_NAMES, type EventRow } from "./traderStats.js";

/// Hand-check for the leaderboard: for one wallet, compare every perp position's PNL as the event log
/// records it against what the chain itself holds. The chain stores, per position, the running sum of
/// price PNL (`realizedPnl`) and of funding (`fundingAccrued`); the event log must add up to the same.
///
///   pnpm --filter @zeno/indexer reconcile 0x<wallet>
///
/// Exits 1 on any difference. Amounts are settlement-token base units.
async function main() {
  const wallet = process.argv[2]?.toLowerCase();
  if (!wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error("usage: reconcile 0x<wallet address>");

  const chainId = resolveChainId(process.env.CHAIN_ID);
  const zeno = new Zeno({ chainId, transport: http(requireEnv("RPC_URL")), addresses: resolveAddresses(chainId) });
  const rows = await getDb()
    .select({ txHash: events.txHash, eventName: events.eventName, args: events.args })
    .from(events)
    .where(inArray(events.eventName, [...STAT_EVENT_NAMES]))
    .orderBy(asc(events.blockNumber), asc(events.logIndex));
  const eventRows: EventRow[] = rows.map((row) => ({ txHash: row.txHash, eventName: row.eventName, args: row.args as Record<string, unknown> }));

  const mine = [...perpNetByPosition(eventRows)].filter(([, state]) => state.owner === wallet);
  let mismatches = 0;
  let eventTotal = 0n;
  let chainTotal = 0n;
  console.log("positionId  events(price+funding)  chain(realizedPnl+fundingAccrued)  match");
  for (const [positionId, state] of mine) {
    const position = await zeno.portfolio.getPerpPosition(BigInt(positionId));
    const onChain = position.realizedPnl + position.fundingAccrued;
    const match = onChain === state.net;
    if (!match) mismatches += 1;
    eventTotal += state.net;
    chainTotal += onChain;
    console.log(`${positionId.padEnd(10)}  ${state.net.toString().padStart(21)}  ${onChain.toString().padStart(33)}  ${match ? "yes" : "NO"}`);
  }
  console.log(`${mine.length} position(s); events ${eventTotal}, chain ${chainTotal}; ${mismatches} mismatch(es)`);
  await getSql().end();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("reconcile:", error instanceof Error ? error.message : error);
  process.exit(1);
});
