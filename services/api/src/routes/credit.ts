import type { FastifyInstance } from "fastify";
import type { Address, PublicClient } from "viem";
import {
  ADDRESS_PATTERN,
  CREDIT_STATUS,
  CREDIT_TIER,
  creditEventsAbi,
  creditHistoryRows,
  creditPairAbi,
  creditPositionResponse,
  creditRegistryAbi,
  erc20DecimalsAbi,
} from "../credit.js";

/// The lending pair, read straight from the chain: the pair holds the positions, so there is nothing for the
/// indexer to derive. Both routes are display data; borrowing, repaying and liquidating happen on chain.
/// Until the pair is deployed (`creditPairTslaUsdg` in the config, or `CREDIT_PAIR_ADDRESS`), the list is
/// empty and the position route answers 404, which the page renders as "not open yet".
/// The RPC allows 10M blocks per `getLogs`. Two chunks look back about three weeks.
// ponytail: history older than two chunks is not shown; the pair is days old on testnet and not on mainnet yet,
// so raise CHUNKS (or store the events in the indexer) when a wallet can be older than that.
const CHUNK = 9_000_000n;
const CHUNKS = 2;
const HISTORY_ROWS = 25;

export function registerCreditRoutes(
  app: FastifyInstance,
  client: Pick<PublicClient, "readContract" | "getLogs" | "getBlockNumber" | "getBlock">,
  pair: Address | undefined,
) {
  /// The pair's configuration and totals. `status` is `normal`, `reduce_only` or `paused`; a paused pair is
  /// still listed, so the page can render it and say so.
  app.get("/v1/credit/markets", async (request, reply) => {
    if (!pair) return [];
    try {
      const [marketId, registry, totalSupplyCollateral, totalBorrowedDebt] = await Promise.all([
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "marketId" }),
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "registry" }),
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "totalSupplyCollateral" }),
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "totalBorrowedDebt" }),
      ]);
      const market = await client.readContract({ address: registry, abi: creditRegistryAbi, functionName: "getMarket", args: [marketId] });
      const [collateralDecimals, debtDecimals] = await Promise.all([
        client.readContract({ address: market.collateralToken, abi: erc20DecimalsAbi, functionName: "decimals" }),
        client.readContract({ address: market.debtToken, abi: erc20DecimalsAbi, functionName: "decimals" }),
      ]);
      return [
        {
          marketId,
          slug: market.slug,
          pair: pair.toLowerCase(),
          collateralToken: market.collateralToken.toLowerCase(),
          debtToken: market.debtToken.toLowerCase(),
          collateralDecimals,
          debtDecimals,
          status: CREDIT_STATUS[market.status] ?? "paused",
          riskTier: CREDIT_TIER[market.riskTier] ?? "experimental",
          maxLtvBps: market.maxLtvBps.toString(),
          liquidationLtvBps: market.liquidationLtvBps.toString(),
          maxLeverageBps: market.maxLeverageBps.toString(),
          supplyCap: market.supplyCap.toString(),
          borrowCap: market.borrowCap.toString(),
          totalSupplyCollateral: totalSupplyCollateral.toString(),
          totalBorrowedDebt: totalBorrowedDebt.toString(),
        },
      ];
    } catch (error) {
      request.log.error({ err: error }, "credit: market read failed");
      return reply.code(502).send({ error: "chain unavailable" });
    }
  });

  /// One wallet's position in the pair, with the contract's own health factor. `healthFactorBps` is in basis
  /// points where 10000 is the liquidation boundary (1.00x): below it the position is liquidatable, and a
  /// higher number is safer. With no debt the contract returns 9990000, so `hasDebt` says whether it is real.
  app.get<{ Params: { wallet: string } }>("/v1/credit/positions/:wallet", async (request, reply) => {
    if (!ADDRESS_PATTERN.test(request.params.wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    if (!pair) return reply.code(404).send({ error: "the credit pair is not deployed yet" });
    const wallet = request.params.wallet as Address;
    try {
      const [position, liquidatable] = await Promise.all([
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "getPosition", args: [wallet] }),
        client.readContract({ address: pair, abi: creditPairAbi, functionName: "isLiquidatable", args: [wallet] }),
      ]);
      const [collateralAmount, debtAmount, collateralValueUsd, healthFactorBps] = position;
      return creditPositionResponse(pair, wallet, { collateralAmount, debtAmount, collateralValueUsd, healthFactorBps }, liquidatable);
    } catch (error) {
      // A stale or missing credit oracle price makes `getPosition` revert: the health factor cannot be read.
      request.log.error({ err: error }, "credit: position read failed");
      return reply.code(503).send({ error: "credit price unavailable" });
    }
  });

  /// One wallet's supply, withdraw, borrow, repay and liquidation events on the pair, newest first, read from
  /// the chain's logs (the indexer does not store them). `timestamp` is the block's time in seconds.
  app.get<{ Params: { wallet: string } }>("/v1/credit/history/:wallet", async (request, reply) => {
    if (!ADDRESS_PATTERN.test(request.params.wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    if (!pair) return [];
    const user = request.params.wallet as Address;
    try {
      const head = await client.getBlockNumber();
      const windows = Array.from({ length: CHUNKS }, (_, i) => {
        const to = head - BigInt(i) * CHUNK;
        return { fromBlock: to - CHUNK + 1n > 0n ? to - CHUNK + 1n : 0n, toBlock: to };
      }).filter((w) => w.toBlock >= 0n);
      const found = await Promise.all(
        windows.flatMap((window) =>
          creditEventsAbi.map((event) => client.getLogs({ address: pair, event, args: { user }, ...window })),
        ),
      );
      const rows = creditHistoryRows(found.flat() as never, HISTORY_ROWS);
      const blocks = await Promise.all([...new Set(rows.map((row) => row.blockNumber))].map((n) => client.getBlock({ blockNumber: BigInt(n) })));
      const time = new Map(blocks.map((block) => [block.number.toString(), Number(block.timestamp)]));
      return rows.map((row) => ({ ...row, timestamp: time.get(row.blockNumber) ?? 0 }));
    } catch (error) {
      request.log.error({ err: error }, "credit: history read failed");
      return reply.code(502).send({ error: "chain unavailable" });
    }
  });
}
