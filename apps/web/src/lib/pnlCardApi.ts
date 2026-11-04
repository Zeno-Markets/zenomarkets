import { LeaderboardHttpError, type PnlCard } from "@zeno/sdk";
import { zenoRead } from "./zeno";

export type CardResult = { kind: "ok"; card: PnlCard } | { kind: "not-found" } | { kind: "unavailable" };

/// One position's card from the API, sorted into the three answers a page can give: a card, "there is no
/// such card" (the position does not exist, is someone else's, or its owner opted out: the API does not say
/// which, and neither does the page), or "try again" (the API or the chain behind it did not answer).
export async function loadPnlCard(wallet: string, positionId: string): Promise<CardResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || !/^\d+$/.test(positionId)) return { kind: "not-found" };
  try {
    return { kind: "ok", card: await zenoRead.leaderboard.pnlCard(wallet, positionId) };
  } catch (error) {
    return error instanceof LeaderboardHttpError && (error.status === 404 || error.status === 400) ? { kind: "not-found" } : { kind: "unavailable" };
  }
}
