import { margin, type OptionOpenPreview, type PerpOpenPreview } from "@zeno/sdk";
import { fmt, fmtBps, fmtPrice, fmtSigned, fmtUsd } from "./format";
import { fmtHealth, healthFactorBps, liquidationPrice, ltvBps, pct } from "./lending";
import { plainSeries, strikeText } from "./options";

/// The figures a review step shows before a signature (docs/UI_CONTRACT.md rule 3), worked out here so the
/// three money paths word them one way and a test can hold them to it. A review that cannot state a
/// liquidation price is not a review: it comes back as a refusal and the order is not offered.
export interface ReviewLine {
  label: string;
  value: string;
  strong?: boolean;
}
export type Review = { rows: ReviewLine[]; worstCase: string; refusal?: undefined } | { refusal: string; rows?: undefined; worstCase?: undefined };

export const LIQUIDATION_REFUSAL =
  "This order is refused because its liquidation price cannot be worked out. Lower the leverage or the size, or try again in a moment.";

/// A long is liquidated below its entry and a short above it. Anything else (a zero price, a zero entry,
/// a level on the wrong side) means the inputs were not sound, and guessing would put money at risk.
export function liquidationKnown(isLong: boolean, entryPrice: bigint, liquidation: bigint): boolean {
  return entryPrice > 0n && liquidation > 0n && (isLong ? liquidation < entryPrice : liquidation > entryPrice);
}

const VENUE_CUT = (fee: bigint, decimals: number) => `${fmtUsd(fee, decimals)}, the whole fee`;

export function perpOpenReview(p: PerpOpenPreview, o: { symbol: string; decimals: number; isLimit: boolean; cap?: bigint }): Review {
  const isLong = p.side === "LONG";
  if (!liquidationKnown(isLong, p.entryPrice, p.liquidationPrice)) return { refusal: LIQUIDATION_REFUSAL };
  const d = o.decimals;
  const after = p.availableBalance === undefined ? "–" : p.availableBalance >= p.totalRequired ? fmtUsd(p.availableBalance - p.totalRequired, d) : "Not enough available";
  const rows: ReviewLine[] = [
    { label: "You pay", value: o.isLimit ? `${fmtUsd(p.totalRequired, d)} when it fills` : fmtUsd(p.totalRequired, d), strong: true },
    { label: "You get", value: `${isLong ? "Long" : "Short"} ${o.symbol}-PERP, ${fmtUsd(p.notional, d)} at ${p.leverage}x` },
    { label: o.isLimit ? (isLong ? "Fills at or below" : "Fills at or above") : "Estimated entry", value: fmtPrice(p.entryPrice) },
    { label: "Margin required", value: fmtUsd(p.collateral, d) },
    { label: "Available after", value: after },
    { label: "Liquidation price", value: fmtPrice(p.liquidationPrice), strong: true },
    { label: "Funding rate now", value: fmtBps(p.fundingRateBps) },
    { label: `Trading fee (${fmtBps(p.feeBps)})`, value: fmtUsd(p.fee, d) },
    { label: "Venue cut", value: VENUE_CUT(p.fee, d) },
  ];
  if (o.cap && o.cap > 0n && p.notional <= o.cap) {
    rows.push({ label: "Position cap", value: `${fmtUsd(o.cap, d, 0)}, ${fmtUsd(o.cap - p.notional, d, 0)} left` });
  }
  return {
    rows,
    worstCase: `If ${o.symbol} ${isLong ? "falls" : "rises"} to $${fmtPrice(p.liquidationPrice)}, the position is liquidated and you lose the ${fmtUsd(p.collateral, d)} margin.`,
  };
}

export function perpCloseReview(
  position: { isLong: boolean; size: bigint; collateral: bigint; entryPrice: bigint; fundingAccrued: bigint },
  o: { symbol: string; decimals: number; mark: bigint; feeBps: bigint; slippageBps: bigint },
): Review {
  const d = o.decimals;
  const pnl = margin.unrealizedPnl(position.isLong, position.entryPrice, o.mark, position.size);
  const fee = margin.feeFromBps(position.size, o.feeBps);
  const back = position.collateral + pnl - fee;
  // Closing a long sells, so its bound is below the mark; closing a short buys, so above it.
  const worst = margin.applyBps(o.mark, position.isLong ? -o.slippageBps : o.slippageBps);
  return {
    rows: [
      { label: "You close", value: `${position.isLong ? "Long" : "Short"} ${o.symbol}-PERP, ${fmtUsd(position.size, d)}` },
      { label: "Closes near", value: fmtPrice(o.mark) },
      { label: "Profit or loss", value: fmtSigned(pnl, d) },
      { label: "Funding so far", value: fmtSigned(position.fundingAccrued, d) },
      { label: `Trading fee (${fmtBps(o.feeBps)})`, value: fmtUsd(fee, d) },
      { label: "Venue cut", value: VENUE_CUT(fee, d) },
      { label: "You get back, about", value: fmtUsd(back > 0n ? back : 0n, d), strong: true },
      { label: "Liquidation price", value: "None once closed", strong: true },
    ],
    worstCase: `If the price moves against you before the close lands, it fills no worse than $${fmtPrice(worst)}. Past that the close is refused and the position stays open.`,
  };
}

const plainExpiry = (expiry: bigint) =>
  `${new Date(Number(expiry) * 1000).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;

export function optionBuyReview(p: OptionOpenPreview, o: { symbol: string; type: "CALL" | "PUT"; decimals: number }): Review {
  const d = o.decimals;
  const after = p.availableBalance === undefined ? "–" : p.availableBalance >= p.totalRequired ? fmtUsd(p.availableBalance - p.totalRequired, d) : "Not enough available";
  return {
    rows: [
      { label: "You pay", value: fmtUsd(p.totalRequired, d), strong: true },
      { label: "You get", value: `${p.contracts} × ${plainSeries(o.symbol, o.type, p.strike, p.expiry)}` },
      { label: "Premium", value: fmtUsd(p.premium, d) },
      { label: `Fee (${fmtBps(p.feeBps)})`, value: fmtUsd(p.fee, d) },
      { label: "Venue cut", value: VENUE_CUT(p.fee, d) },
      { label: "Available after", value: after },
      { label: "Break-even at expiry", value: fmtPrice(p.breakEven) },
      { label: "Expires", value: plainExpiry(p.expiry) },
      { label: "Max loss", value: fmtUsd(p.maxLoss, d), strong: true },
      { label: "Liquidation price", value: "None. A bought option cannot be liquidated", strong: true },
    ],
    worstCase: `If ${o.symbol} is at or ${o.type === "CALL" ? "below" : "above"} $${strikeText(p.strike)} at expiry, the option expires worthless and you lose ${fmtUsd(p.maxLoss, d)}.`,
  };
}

export interface CreditReviewInput {
  action: "supply" | "borrow";
  amount: bigint;
  symbol: string;
  collateralAmount: bigint;
  debtAmount: bigint;
  /// The collateral's USD price, 18 decimals. Undefined while it cannot be read.
  price?: bigint;
  collateralDecimals: number;
  debtDecimals: number;
  maxLtvBps: bigint;
  liquidationLtvBps: bigint;
  liquidationBonusBps?: bigint;
  supplyCap: bigint;
  totalSupplyCollateral: bigint;
  borrowCap: bigint;
  totalBorrowedDebt: bigint;
}

export function creditReview(c: CreditReviewInput): Review {
  const supply = c.action === "supply";
  const coll = c.collateralAmount + (supply ? c.amount : 0n);
  const debt = c.debtAmount + (supply ? 0n : c.amount);
  const cd = c.collateralDecimals;
  const dd = c.debtDecimals;

  // The pair reverts past either cap, so the refusal comes here, in words, before anything is signed.
  if (supply && c.supplyCap > 0n && c.totalSupplyCollateral + c.amount > c.supplyCap) {
    const left = c.supplyCap > c.totalSupplyCollateral ? c.supplyCap - c.totalSupplyCollateral : 0n;
    return { refusal: `This would pass the pair's supply cap. ${fmt(left, cd, 6)} ${c.symbol} can still be supplied.` };
  }
  if (!supply && c.borrowCap > 0n && c.totalBorrowedDebt + c.amount > c.borrowCap) {
    const left = c.borrowCap > c.totalBorrowedDebt ? c.borrowCap - c.totalBorrowedDebt : 0n;
    return { refusal: `This would pass the pair's borrow cap. ${fmtUsd(left, dd, 3)} can still be borrowed.` };
  }
  if (debt > 0n && coll === 0n) return { refusal: `Supply ${c.symbol} first: a loan needs collateral behind it.` };
  if (debt > 0n && c.price === undefined) return { refusal: LIQUIDATION_REFUSAL };

  // The debt token is USDG, valued at a dollar, the same assumption the position card makes.
  const collValue = c.price === undefined ? undefined : (coll * c.price) / 10n ** BigInt(cd);
  const debtValue = (debt * 10n ** 18n) / 10n ** BigInt(dd);
  const ltv = collValue === undefined ? undefined : ltvBps(collValue, debtValue);
  if (!supply && (ltv === undefined || ltv > c.maxLtvBps)) {
    return { refusal: `This would borrow past the limit of ${pct(c.maxLtvBps)} of your collateral's value. Borrow less, or supply more first.` };
  }
  const hf = collValue === undefined ? undefined : healthFactorBps(collValue, debtValue, c.liquidationLtvBps);
  const liq = debt === 0n || hf === undefined || c.price === undefined ? undefined : liquidationPrice(c.price, hf);
  if (debt > 0n && (liq === undefined || liq === 0n)) return { refusal: LIQUIDATION_REFUSAL };

  const cap = supply
    ? { label: "Supply cap", value: c.supplyCap > 0n ? `${fmt(c.supplyCap - c.totalSupplyCollateral - c.amount, cd, 6)} ${c.symbol} left after this` : "None" }
    : { label: "Borrow cap", value: c.borrowCap > 0n ? `${fmtUsd(c.borrowCap - c.totalBorrowedDebt - c.amount, dd, 3)} left after this` : "None" };
  const bonus = c.liquidationBonusBps === undefined ? "" : ` plus a ${pct(c.liquidationBonusBps)} bonus`;
  return {
    rows: [
      supply
        ? { label: "You supply", value: `${fmt(c.amount, cd, 6)} ${c.symbol}`, strong: true }
        : { label: "You borrow", value: fmtUsd(c.amount, dd, 3), strong: true },
      { label: "Supplied after", value: `${fmt(coll, cd, 6)} ${c.symbol}` },
      { label: "Borrowed after", value: fmtUsd(debt, dd, 3) },
      { label: "Loan to value after", value: ltv === undefined ? "–" : `${pct(ltv)} (limit ${pct(c.maxLtvBps)})` },
      { label: "Health factor after", value: hf === undefined ? "–" : fmtHealth(hf) },
      { label: `Liquidation price of ${c.symbol}`, value: liq === undefined ? "None while you owe nothing" : `$${fmt(liq, 18, 2)}`, strong: true },
      { label: "Interest", value: "None. You repay what you borrow" },
      { label: "Fees and venue cut", value: "None" },
      cap,
    ],
    worstCase:
      liq === undefined
        ? `While you owe nothing, no fall in ${c.symbol} can liquidate you.`
        : `If ${c.symbol} falls to $${fmt(liq, 18, 2)}, anyone can repay part of the loan and take your ${c.symbol}${bonus}.`,
  };
}
