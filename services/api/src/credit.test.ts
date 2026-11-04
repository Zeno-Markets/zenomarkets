import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { Address, PublicClient } from "viem";
import { creditHistoryRows, NO_DEBT_HEALTH_FACTOR_BPS, resolveCreditPair } from "./credit.js";
import { registerCreditRoutes } from "./routes/credit.js";

const PAIR = `0x${"c1".repeat(20)}` as Address;
const WALLET = `0x${"ab".repeat(20)}`;
const TSLA = `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` as Address;
const USDG = `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` as Address;

/// A chain that answers by function name, with the values from the Phase 9 handoff.
function fakeClient(over: Record<string, unknown> = {}, fail = false): Pick<PublicClient, "readContract" | "getLogs" | "getBlockNumber" | "getBlock"> {
  const answers: Record<string, unknown> = {
    marketId: `0x${"11".repeat(32)}`,
    registry: `0x${"22".repeat(20)}`,
    totalSupplyCollateral: 1_000n,
    totalBorrowedDebt: 0n,
    isLiquidatable: false,
    getPosition: [1_000n, 0n, 370n * 10n ** 15n, NO_DEBT_HEALTH_FACTOR_BPS],
    getMarket: {
      slug: "tsla-usdg",
      collateralToken: TSLA,
      debtToken: USDG,
      oracle: `0x${"33".repeat(20)}`,
      riskTier: 0,
      status: 2,
      maxLtvBps: 6000n,
      liquidationLtvBps: 7000n,
      maxLeverageBps: 25000n,
      supplyCap: 10n ** 15n,
      borrowCap: 8000n,
    },
    decimals: 6,
    ...over,
  };
  return {
    readContract: (async (request: { address: Address; functionName: string }) => {
      if (fail) throw new Error("rpc down");
      if (request.functionName === "decimals") return request.address === TSLA ? 18 : 6;
      return answers[request.functionName];
    }) as never,
    getBlockNumber: (async () => 1_000n) as never,
    getLogs: (async () => []) as never,
    getBlock: (async () => ({ number: 1n, timestamp: 1_700_000_000n })) as never,
  };
}

test("the pair address comes from the deployment record first, then the environment, and only if well formed", () => {
  assert.equal(resolveCreditPair({ creditPairTslaUsdg: PAIR }, "0x1234"), PAIR);
  assert.equal(resolveCreditPair({}, PAIR), PAIR);
  assert.equal(resolveCreditPair({}, "not an address"), undefined);
  assert.equal(resolveCreditPair({}, undefined), undefined);
});

test("the market list carries the configured risk numbers and shows a paused pair rather than hiding it", async () => {
  const app = Fastify();
  registerCreditRoutes(app, fakeClient(), PAIR);
  const response = await app.inject({ url: "/v1/credit/markets" });
  assert.equal(response.statusCode, 200);
  const [market] = response.json();
  assert.equal(market.slug, "tsla-usdg");
  assert.equal(market.status, "paused");
  assert.equal(market.riskTier, "tier_a");
  assert.equal(market.maxLtvBps, "6000");
  assert.equal(market.liquidationLtvBps, "7000");
  assert.equal(market.supplyCap, (10n ** 15n).toString());
  assert.equal(market.borrowCap, "8000");
  assert.equal(market.collateralDecimals, 18);
  assert.equal(market.debtDecimals, 6);
  assert.equal(market.pair, PAIR.toLowerCase());
});

test("no pair deployed: an empty list, and a 404 on a position, not an error", async () => {
  const app = Fastify();
  registerCreditRoutes(app, fakeClient(), undefined);
  assert.deepEqual((await app.inject({ url: "/v1/credit/markets" })).json(), []);
  assert.equal((await app.inject({ url: `/v1/credit/positions/${WALLET}` })).statusCode, 404);
});

test("a position reports the contract's basis-point health factor unchanged, and flags the no-debt sentinel", async () => {
  const app = Fastify();
  registerCreditRoutes(app, fakeClient(), PAIR);
  const empty = (await app.inject({ url: `/v1/credit/positions/${WALLET}` })).json();
  assert.equal(empty.healthFactorBps, "9990000");
  assert.equal(empty.hasDebt, false);
  assert.equal(empty.liquidatable, false);

  const borrowing = Fastify();
  registerCreditRoutes(borrowing, fakeClient({ getPosition: [10n ** 18n, 100_000_000n, 370n * 10n ** 18n, 12_500n], isLiquidatable: false }), PAIR);
  const healthy = (await borrowing.inject({ url: `/v1/credit/positions/${WALLET}` })).json();
  assert.equal(healthy.healthFactorBps, "12500"); // 1.25x: 25 % above the liquidation boundary
  assert.equal(healthy.hasDebt, true);
  assert.equal(healthy.collateralAmount, (10n ** 18n).toString());
  assert.equal(healthy.debtAmount, "100000000");

  const under = Fastify();
  registerCreditRoutes(under, fakeClient({ getPosition: [10n ** 18n, 100_000_000n, 100n * 10n ** 18n, 9_000n], isLiquidatable: true }), PAIR);
  const risky = (await under.inject({ url: `/v1/credit/positions/${WALLET}` })).json();
  assert.equal(risky.healthFactorBps, "9000");
  assert.equal(risky.liquidatable, true);
});

test("a bad wallet is a 400 and an unreadable chain is a 5xx, never a wrong number", async () => {
  const app = Fastify();
  registerCreditRoutes(app, fakeClient({}, true), PAIR);
  assert.equal((await app.inject({ url: "/v1/credit/positions/nope" })).statusCode, 400);
  assert.equal((await app.inject({ url: `/v1/credit/positions/${WALLET}` })).statusCode, 503);
  assert.equal((await app.inject({ url: "/v1/credit/markets" })).statusCode, 502);
});

test("history is newest first, names each event by what the wallet did, and a liquidation carries the collateral taken", () => {
  const log = (eventName: string, blockNumber: bigint, logIndex: number, args: object) => ({ eventName, args, transactionHash: `0x${blockNumber}`, blockNumber, logIndex });
  const rows = creditHistoryRows(
    [
      log("CollateralDeposited", 10n, 0, { amount: 5n }),
      log("DebtBorrowed", 12n, 1, { amount: 7n }),
      log("DebtRepaid", 12n, 3, { amount: 7n }),
      log("PositionLiquidated", 20n, 0, { debtRepaid: 4n, collateralSeized: 9n }),
      log("Unknown", 30n, 0, {}),
    ],
    3,
  );
  assert.deepEqual(rows.map((r) => r.kind), ["liquidated", "repay", "borrow"]);
  assert.deepEqual([rows[0]!.amount, rows[0]!.collateralSeized], ["4", "9"]);
});

test("the history route answers an empty list for a quiet wallet and 400 for a bad address", async () => {
  const app = Fastify();
  registerCreditRoutes(app, fakeClient(), PAIR);
  assert.deepEqual((await app.inject({ url: `/v1/credit/history/${WALLET}` })).json(), []);
  assert.equal((await app.inject({ url: "/v1/credit/history/nope" })).statusCode, 400);
});
