import { analyzeStrategy, type Leg } from "@zeno/sdk";

/// Illustrative figures for the product previews on the landing and features pages, used only while no
/// live market is listed. They are not prices and not quotes, and every preview that reads them carries
/// `SAMPLE DATA`. Round numbers on purpose, so nobody takes them for a market.
export const PREVIEW_PERP = {
  symbol: "TSLA",
  mark: 250,
  leverage: 5,
  size: 5_000,
  maintenanceMarginRate: 0.05,
} as const;

/// A long straddle, which the contracts can open today (every leg is a bought option).
const STRADDLE_LEGS: Leg[] = [
  { kind: "CALL", side: "LONG", strike: 250, quantity: 1, price: 12 },
  { kind: "PUT", side: "LONG", strike: 250, quantity: 1, price: 11 },
];

export const PREVIEW_OPTION = {
  label: "Straddle",
  spot: 250,
  low: 190,
  high: 310,
  analysis: analyzeStrategy(STRADDLE_LEGS),
} as const;

/// The example vault position: collateral value, and the share of it that is borrowed.
export const PREVIEW_VAULT = { collateralUsd: 1_000n * 10n ** 18n, borrowedShare: 40n } as const;
