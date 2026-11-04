import assert from "node:assert/strict";
import { test } from "node:test";
import { margin, type OptionOpenPreview, type PerpOpenPreview } from "@zeno/sdk";
import { creditReview, LIQUIDATION_REFUSAL, liquidationKnown, optionBuyReview, perpCloseReview, perpOpenReview, type CreditReviewInput } from "./review.js";

const E18 = 10n ** 18n;
const USD = (dollars: number) => BigInt(dollars) * 1_000_000n;
const value = (review: ReturnType<typeof perpOpenReview>, label: string) => review.rows?.find((row) => row.label === label)?.value;

function perpPreview(over: Partial<PerpOpenPreview> = {}): PerpOpenPreview {
  const entry = 200n * E18;
  const collateral = USD(1000);
  const notional = collateral * 5n;
  return {
    marketId: "0x00",
    side: "LONG",
    indexPrice: entry,
    entryPrice: entry,
    worstPrice: entry,
    collateral,
    leverage: 5n,
    notional,
    fee: USD(4),
    feeBps: 8n,
    totalRequired: collateral + USD(4),
    maintenanceMarginRateBps: 500n,
    liquidationPrice: margin.liquidationPrice(true, entry, collateral, notional, 500n),
    fundingRateBps: 1n,
    nextFundingTimestamp: 0n,
    availableBalance: USD(2000),
    sufficientCollateral: true,
    violations: [],
    ...over,
  } as PerpOpenPreview;
}

test("liquidationKnown accepts a level on the losing side of entry only", () => {
  assert.equal(liquidationKnown(true, 200n, 170n), true);
  assert.equal(liquidationKnown(false, 200n, 230n), true);
  assert.equal(liquidationKnown(true, 200n, 0n), false);
  assert.equal(liquidationKnown(true, 200n, 230n), false);
  assert.equal(liquidationKnown(false, 200n, 170n), false);
  assert.equal(liquidationKnown(true, 0n, 0n), false);
});

test("a perp review states the liquidation price, the worst case and the money left", () => {
  const review = perpOpenReview(perpPreview(), { symbol: "NVDA", decimals: 6, isLimit: false, cap: USD(50_000) });
  assert.ok(review.rows);
  assert.equal(value(review, "Liquidation price"), "170.00");
  assert.equal(value(review, "You pay"), "$1,004.00");
  assert.equal(value(review, "Available after"), "$996.00");
  assert.equal(value(review, "Venue cut"), "$4.00, the whole fee");
  assert.equal(value(review, "Position cap"), "$50,000, $45,000 left");
  assert.equal(review.worstCase, "If NVDA falls to $170.00, the position is liquidated and you lose the $1,000.00 margin.");
});

test("a perp order whose liquidation price cannot be worked out is refused, not guessed", () => {
  assert.equal(perpOpenReview(perpPreview({ liquidationPrice: 0n }), { symbol: "NVDA", decimals: 6, isLimit: false }).refusal, LIQUIDATION_REFUSAL);
  assert.equal(perpOpenReview(perpPreview({ side: "SHORT" }), { symbol: "NVDA", decimals: 6, isLimit: false }).refusal, LIQUIDATION_REFUSAL);
});

test("a close review bounds the fill on the side the price can hurt", () => {
  const position = { isLong: true, size: USD(5000), collateral: USD(1000), entryPrice: 200n * E18, fundingAccrued: 0n };
  const review = perpCloseReview(position, { symbol: "NVDA", decimals: 6, mark: 210n * E18, feeBps: 8n, slippageBps: 50n });
  assert.ok(review.rows);
  // +5% on $5,000 is +$250, less the $4 fee, on top of the $1,000 margin.
  assert.equal(review.rows.find((row) => row.label === "You get back, about")?.value, "$1,246.00");
  assert.match(review.worstCase, /no worse than \$208\.95/);
});

test("an option review says it cannot be liquidated and names the max loss", () => {
  const p = { contracts: 2n, strike: 190n * E18, expiry: 1_790_000_000n, premium: USD(10), fee: USD(1), feeBps: 10n, totalRequired: USD(11), breakEven: 195n * E18, maxLoss: USD(11) } as OptionOpenPreview;
  const review = optionBuyReview(p, { symbol: "NVDA", type: "CALL", decimals: 6 });
  assert.ok(review.rows);
  assert.match(review.rows.find((row) => row.label === "Liquidation price")?.value ?? "", /cannot be liquidated/);
  assert.equal(review.worstCase, "If NVDA is at or below $190 at expiry, the option expires worthless and you lose $11.00.");
});

const credit: CreditReviewInput = {
  action: "borrow",
  amount: USD(100),
  symbol: "TSLA",
  collateralAmount: 1n * E18,
  debtAmount: 0n,
  price: 400n * E18,
  collateralDecimals: 18,
  debtDecimals: 6,
  maxLtvBps: 6000n,
  liquidationLtvBps: 7000n,
  supplyCap: 0n,
  totalSupplyCollateral: 0n,
  borrowCap: 0n,
  totalBorrowedDebt: 0n,
};

test("a borrow review prices the collateral's liquidation level", () => {
  const review = creditReview(credit);
  assert.ok(review.rows);
  // $100 debt over 1 TSLA at a 70% threshold: liquidated when 0.7 x price = 100, so at $142.86.
  assert.equal(review.rows.find((row) => row.label === "Liquidation price of TSLA")?.value, "$142.86");
});

test("a borrow past the limit, past a cap, or without a price is refused", () => {
  assert.match((creditReview({ ...credit, amount: USD(300) }) as { refusal: string }).refusal, /past the limit of 60%/);
  assert.match((creditReview({ ...credit, borrowCap: USD(50) }) as { refusal: string }).refusal, /borrow cap/);
  assert.equal(creditReview({ ...credit, price: undefined }).refusal, LIQUIDATION_REFUSAL);
  assert.match(creditReview({ ...credit, collateralAmount: 0n }).refusal ?? "", /Supply TSLA first/);
});

test("a supply with no debt has no liquidation price and says so", () => {
  const review = creditReview({ ...credit, action: "supply", amount: E18 / 2n, price: undefined });
  assert.ok(review.rows);
  assert.equal(review.rows.find((row) => row.label === "Liquidation price of TSLA")?.value, "None while you owe nothing");
});
