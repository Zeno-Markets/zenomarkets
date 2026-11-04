import type { Zeno } from "@zeno/sdk";
import type { FastifyInstance } from "fastify";
import { BaseError, ContractFunctionRevertedError, toFunctionSelector } from "viem";

/// What the oracle will let a price be used for right now, mirroring `ZenoPriceValidator.PriceState`.
/// `closed` and `stale` are normal states, not faults: outside its session an equity market has no
/// usable price, and `ZenoOracleRouter` reverts rather than serving a carried-over one.
export type PriceState = "fresh" | "closed" | "stale" | "paused";

/// `MarketSessionClosed` and the paused error are not in `@zeno/sdk`'s generated ABIs (they were
/// added to `ZenoPriceValidator` after the ABIs were last generated, and `packages/sdk` belongs to
/// another lane), so the four selectors are derived here from the signatures in
/// `packages/contracts/src/oracle/ZenoPriceValidator.sol` and `ZenoOracleRouter.sol`.
const STATE_BY_SELECTOR = new Map<string, PriceState>([
  [toFunctionSelector("MarketSessionClosed(bytes32)"), "closed"],
  [toFunctionSelector("StaleOraclePrice()"), "stale"],
  [toFunctionSelector("MarketOraclePaused(bytes32)"), "paused"],
  [toFunctionSelector("NoPriceSource(bytes32)"), "paused"],
]);

/// The `PriceState` a revert stands for, or `undefined` when the revert is a real fault that must
/// keep propagating — a wrong address, a broken RPC, a bug — rather than a shut market.
export function priceStateFromRevert(error: unknown): PriceState | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;

  const selector = reverted.signature ?? reverted.raw?.slice(0, 10);
  return selector ? STATE_BY_SELECTOR.get(selector) : undefined;
}

/// PROJECT_BRIEF.md Section 17's three live price types (Settlement Price only exists once
/// an expiry has actually settled — read via the indexed `OptionSettled` event, not here).
///
/// A market whose session is shut answers 200 with `state` and null prices, never a 500 carrying a
/// raw revert string: `docs/UI_CONTRACT.md` requires the closed state to render, and a paused or
/// closed market is a shipped market.
export function registerPriceRoutes(app: FastifyInstance, zeno: Zeno) {
  app.get<{ Params: { symbol: string } }>("/v1/prices/:symbol", async (request) => {
    const marketId = request.params.symbol;
    try {
      const [index, mark, last] = await Promise.all([
        zeno.oracle.getIndexPrice(marketId),
        zeno.oracle.getMarkPrice(marketId),
        zeno.oracle.getLastPrice(marketId),
      ]);
      return {
        state: "fresh" satisfies PriceState,
        indexPrice: { price: index.price.toString(), timestamp: index.timestamp.toString() },
        markPrice: { price: mark.price.toString(), timestamp: mark.timestamp.toString() },
        lastPrice: { price: last.price.toString(), timestamp: last.timestamp.toString() },
      };
    } catch (error) {
      const state = priceStateFromRevert(error);
      if (!state) throw error;
      return { state, indexPrice: null, markPrice: null, lastPrice: null };
    }
  });
}
