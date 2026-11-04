/// Where a long position is liquidated, for the product preview: the entry price less the margin that
/// is not kept back for maintenance. With leverage L and maintenance margin rate m, the margin is 1/L of
/// the position, so the price can fall by 1/L - m before the position is at risk. A display estimate for a
/// preview, not the contract's own figure; the terminal's review step shows the real one.
export function longLiquidationPrice(entry: number, leverage: number, maintenanceMarginRate: number): number {
  return entry * (1 - 1 / leverage + maintenanceMarginRate);
}

/// The price tape on the features page: one price move, in percent from entry, that the three product
/// previews all read. The range is wide enough for a 5x long to be liquidated and a 40%-borrowed vault to
/// come close to its borrow limit without being liquidated, which is the point of showing them together.
export const TAPE_MIN = -30;
export const TAPE_MAX = 25;
export const TAPE_STEP_MS = 1200;
/// The auto-play script, one tick per step, then round again.
export const TAPE_PATH = [0, 4, 9, 3, -6, -12, -18, -24, -30, -21, -11, -3, 3, 0] as const;

export const clampTape = (pct: number) => Math.min(TAPE_MAX, Math.max(TAPE_MIN, pct));

/// The price after a move of `pct` percent from `entry`.
export const priceAfter = (entry: number, pct: number) => entry * (1 + pct / 100);

/// The move in percent that takes `entry` to `price`.
export const moveTo = (entry: number, price: number) => (price / entry - 1) * 100;

/// Scales a base-unit amount by a move of `pct` percent, in whole basis points of the multiplier so the
/// vault preview can keep its integer arithmetic.
export const scaleByPct = (value: bigint, pct: number) => (value * BigInt(Math.round((100 + pct) * 100))) / 10_000n;

/// The index in the script nearest to `pct`, so Play carries on from where the visitor left the tape.
export function nearestTapeStep(pct: number): number {
  let best = 0;
  TAPE_PATH.forEach((value, index) => {
    if (Math.abs(value - pct) < Math.abs(TAPE_PATH[best]! - pct)) best = index;
  });
  return best;
}
