import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZenoClient } from "./client.js";
import { createCredit } from "./credit.js";

const PAIR = "0x0000000000000000000000000000000000000001" as const;
const USER = "0x0000000000000000000000000000000000000002" as const;

/// A client that answers by function name, so the test checks the SDK's shape and not viem.
const clientFor = (answers: Record<string, unknown>) =>
  ({ readContract: async ({ functionName }: { functionName: string }) => answers[functionName] }) as unknown as ZenoClient;

test("position restores the four figures and the liquidation flag", async () => {
  const credit = createCredit(clientFor({ getPosition: [10n ** 15n, 8_000n, 370n * 10n ** 15n, 12_500n], isLiquidatable: false }));
  assert.deepEqual(await credit.position(PAIR, USER), {
    collateralAmount: 10n ** 15n,
    debtAmount: 8_000n,
    collateralValueUsd: 370n * 10n ** 15n,
    healthFactorBps: 12_500n,
    liquidatable: false,
  });
});

test("market reads a paused pair as PAUSED and an unknown status as PAUSED too", async () => {
  const config = (status: number) => ({
    slug: "tsla-usdg",
    status,
    maxLtvBps: 6000n,
    liquidationLtvBps: 7000n,
    supplyCap: 10n ** 15n,
    borrowCap: 8000n,
  });
  const answers = { marketId: "0x01", registry: PAIR, collateralToken: USER, debtToken: USER, oracle: USER, totalSupplyCollateral: 0n, totalBorrowedDebt: 0n, liquidationBonusBps: 500n };
  assert.equal((await createCredit(clientFor({ ...answers, getMarket: config(2) })).market(PAIR)).status, "PAUSED");
  assert.equal((await createCredit(clientFor({ ...answers, getMarket: config(0) })).market(PAIR)).status, "NORMAL");
  // A status the page does not know must never read as open.
  assert.equal((await createCredit(clientFor({ ...answers, getMarket: config(9) })).market(PAIR)).status, "PAUSED");
});
