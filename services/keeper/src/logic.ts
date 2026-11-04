import { triggerFiresBelow, type OpenOrder, type TriggerOrder } from "@zeno/sdk";

/// A limit order can be filled when it is open, has not expired, and the mark price has reached
/// its trigger: at or below it for a long, at or above it for a short. This mirrors
/// `ZenoPerpsEngine.executeLimitOrder`; the contract makes the final call, so a wrong answer here costs
/// at most a reverted simulation, never a bad fill.
export function isFillable(order: OpenOrder, markPrice: bigint, nowSeconds: bigint): boolean {
  if (order.status !== "OPEN") return false;
  if (nowSeconds > order.expiry) return false;
  return order.isLong ? markPrice <= order.triggerPrice : markPrice >= order.triggerPrice;
}

/// A stop-loss or take-profit can fire when it is open, has not expired, and the mark price has
/// reached its trigger: at or below it for a long's stop-loss and a short's take-profit, at or
/// above it otherwise. `isLong` is the side of the position it is attached to. This mirrors
/// `ZenoPerpsEngine.executeTriggerOrder`; the contract makes the final call.
export function isTriggerReached(order: TriggerOrder, isLong: boolean, markPrice: bigint, nowSeconds: bigint): boolean {
  if (order.status !== "OPEN") return false;
  if (nowSeconds > order.expiry) return false;
  return triggerFiresBelow(isLong, order.kind) ? markPrice <= order.triggerPrice : markPrice >= order.triggerPrice;
}

/// The lowest order id still worth looking at: every order below it is settled (filled or
/// cancelled) or expired. Orders are stored by ascending id, so the scan can start here next time.
/// `orders` must be ascending and start at `from`. Works for limit and trigger orders alike.
export function nextCursor(
  orders: Array<{ id: bigint; status: OpenOrder["status"]; expiry: bigint }>,
  from: bigint,
  nowSeconds: bigint,
): bigint {
  let cursor = from;
  for (const order of orders) {
    const finished = order.status !== "OPEN" || nowSeconds > order.expiry;
    if (!finished) break;
    cursor = order.id + 1n;
  }
  return cursor;
}

/// A price feed needs a fresh push once its last update is at least `refreshSeconds` old. Set it
/// well inside the oracle's staleness window (1 hour by default) so a late keeper tick does not
/// leave the market stale.
export function feedNeedsRefresh(updatedAt: bigint, nowSeconds: bigint, refreshSeconds: bigint): boolean {
  return nowSeconds - updatedAt >= refreshSeconds;
}

/// Testnet feeds follow the real market: push when the reference has moved at least `minMoveBps` from the stored
/// price, or when the stored price is about to go stale. `reference` is undefined when no quote could be fetched.
export function nextFeedPrice(stored: bigint, updatedAt: bigint, nowSeconds: bigint, refreshSeconds: bigint, reference: bigint | undefined, minMoveBps: bigint): bigint | undefined {
  const stale = feedNeedsRefresh(updatedAt, nowSeconds, refreshSeconds);
  if (reference === undefined || reference <= 0n) return stale ? stored : undefined;
  const move = stored === 0n ? 10_000n : ((reference > stored ? reference - stored : stored - reference) * 10_000n) / stored;
  return stale || move >= minMoveBps ? reference : undefined;
}
