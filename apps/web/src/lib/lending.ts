/// Health-factor arithmetic for the lending page, mirroring `ZenoCreditPair.getPosition` so a worked example
/// on screen agrees with what the contract would answer. The scaling is the one the contracts lane
/// published (docs/evidence/phase-9.md): basis points, where 10000 is 1.00x, exactly at the liquidation
/// threshold. Higher is safer, under 10000 is liquidatable, and a position with no debt reads 9,990,000.

export const HF_ONE = 10_000n;
export const HF_NO_DEBT = 9_990_000n;
const BPS = 10_000n;

/// Basis points as a short percentage: 6000 -> "60%", 6050 -> "60.5%".
export const pct = (bps: bigint) => `${(Number(bps) / 100).toFixed(bps % 100n === 0n ? 0 : 1)}%`;

/// `healthFactor = collateralValue * liquidationLtv / debtValue`, in basis points, with the contract's
/// edge cases: no debt is "safe, 999.00x", collateral gone with debt left is 0.
export function healthFactorBps(collateralValueUsd: bigint, debtValueUsd: bigint, liquidationLtvBps: bigint): bigint {
  if (debtValueUsd === 0n) return HF_NO_DEBT;
  if (collateralValueUsd === 0n) return 0n;
  return (((collateralValueUsd * liquidationLtvBps) / BPS) * BPS) / debtValueUsd;
}

export type HealthBand = "none" | "safe" | "watch" | "danger" | "liquidatable";

/// The words for a number. 1.5x or more is safe, down to 1.2x is worth watching, under that is close to the
/// line, and under 1.0x anyone may liquidate.
export function healthBand(hf: bigint): HealthBand {
  if (hf >= HF_NO_DEBT) return "none";
  if (hf < HF_ONE) return "liquidatable";
  if (hf < 12_000n) return "danger";
  if (hf < 15_000n) return "watch";
  return "safe";
}

/// "1.50x". A position with no debt shows a dash: 999.00x is the contract's way of saying "not applicable".
export function fmtHealth(hf: bigint): string {
  return hf >= HF_NO_DEBT ? "–" : `${(Number(hf) / 10_000).toFixed(2)}x`;
}

/// How far the collateral's price can fall, as a share of today's, before health reaches 1.00x. Health is
/// proportional to collateral value, so it is `1 - 1/health`. Zero at or under the line, and undefined (no
/// debt) when there is nothing to be liquidated for.
export function fallToLiquidationBps(hf: bigint): bigint | undefined {
  if (hf >= HF_NO_DEBT) return undefined;
  if (hf <= HF_ONE) return 0n;
  return BPS - (HF_ONE * BPS) / hf;
}

/// The collateral price (18 decimals) at which health reaches 1.00x, from today's price and health.
export function liquidationPrice(collateralPrice: bigint, hf: bigint): bigint | undefined {
  if (hf >= HF_NO_DEBT || hf === 0n) return undefined;
  return (collateralPrice * HF_ONE) / hf;
}

/// Loan-to-value in basis points: debt over collateral value.
export function ltvBps(collateralValueUsd: bigint, debtValueUsd: bigint): bigint {
  return collateralValueUsd === 0n ? 0n : (debtValueUsd * BPS) / collateralValueUsd;
}

export const healthWords: Record<HealthBand, { label: string; meaning: string }> = {
  none: { label: "No loan", meaning: "You have not borrowed, so there is nothing to be liquidated for." },
  safe: { label: "Safe", meaning: "Your collateral is worth comfortably more than the loan needs." },
  watch: { label: "Watch it", meaning: "The collateral has less room than it did. A fall in its price brings you close to liquidation." },
  danger: { label: "Close to liquidation", meaning: "A small fall in the collateral's price would put the loan under water. Repay some or add collateral." },
  liquidatable: { label: "Liquidatable", meaning: "The collateral no longer covers the loan. Anyone can repay part of it and take collateral at a discount." },
};

/// What the pair says about itself, in a sentence a person can act on. `NORMAL` has none.
export function statusSentence(status: "NORMAL" | "REDUCE_ONLY" | "PAUSED"): string | undefined {
  if (status === "PAUSED") return "This market is paused. It still shows its prices and your position, and it refuses new supply and new borrowing until it reopens.";
  if (status === "REDUCE_ONLY") return "This market is in reduce-only mode. You can repay and withdraw; new borrowing is refused.";
  return undefined;
}
