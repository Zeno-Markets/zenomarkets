import type { PnlCard } from "@zeno/sdk";
import type { PnlCardProps } from "@zeno/ui";
import { margin } from "@zeno/sdk";
import { fmtPrice, fmtSigned, fmtUsd } from "./format";
import { fmtSignedBps } from "./leaderboard";

/// The pieces a card is built from, in the units the API and the chain use. Both the real card (from
/// `GET /v1/pnl-card`) and the sample card (from the sample account) reduce to this, so one formatter
/// decides how a card reads.
export interface CardParts {
  symbol: string;
  isLong: boolean;
  leverage: number;
  status: "open" | "closed" | "liquidated";
  /// Total PNL, settlement-token base units.
  totalPnl: bigint;
  roiBps: bigint;
  entryPrice: bigint;
  /// 18-decimal. The close price, or the live mark while open.
  exitPrice?: bigint | null;
  size: bigint;
  decimals: number;
  /// ISO 8601 of the event the period line names.
  at?: string | null;
  sample: boolean;
}

const date = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function cardProps(parts: CardParts): PnlCardProps {
  const { totalPnl, decimals } = parts;
  const rounded = fmtSigned(totalPnl, decimals);
  const flat = !rounded.startsWith("+") && !rounded.startsWith("−");
  return {
    symbol: parts.symbol,
    side: parts.isLong ? "long" : "short",
    leverage: parts.leverage,
    status: parts.status,
    pnl: rounded,
    roi: fmtSignedBps(parts.roiBps),
    direction: flat ? "flat" : totalPnl > 0n ? "gain" : "loss",
    entry: `$${fmtPrice(parts.entryPrice)}`,
    exit: parts.exitPrice == null ? undefined : `$${fmtPrice(parts.exitPrice)}`,
    size: fmtUsd(parts.size, decimals, 0),
    period: parts.at ? `${parts.status === "open" ? "Opened" : parts.status === "liquidated" ? "Liquidated" : "Closed"} ${date(parts.at)}` : undefined,
    sample: parts.sample,
  };
}

export function cardPartsFromApi(card: PnlCard): CardParts {
  return {
    symbol: card.symbol,
    isLong: card.side === "long",
    leverage: card.leverage,
    status: card.status,
    totalPnl: card.totalPnl,
    roiBps: card.roiBps,
    entryPrice: card.entryPrice,
    exitPrice: card.status === "open" ? card.markPrice : card.exitPrice,
    size: card.size,
    decimals: card.settlementDecimals,
    at: card.status === "open" ? card.openedAt : (card.closedAt ?? card.openedAt),
    sample: card.sample,
  };
}
