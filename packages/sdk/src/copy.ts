/// The two texts a follower signs for copy trading (`docs/COPY_TRADING.md`). They live here so the web app that
/// asks for the signature and the API that checks it can never word them differently.

export interface CopyFollowTerms {
  follower: string;
  leader: string;
  subaccount: string;
  /// Settlement-token base units, as whole-number strings.
  maxTradeSize: string;
  maxExposure: string;
  maxLeverage: number;
  /// Symbols the follower allows, or null for every market.
  markets: string[] | null;
  /// Unix seconds.
  issuedAt: number;
}

export function copyFollowMessage(r: CopyFollowTerms): string {
  return [
    "Zeno copy trading: follow",
    `Follower: ${r.follower.toLowerCase()}`,
    `Leader: ${r.leader.toLowerCase()}`,
    `Copy subaccount: ${r.subaccount.toLowerCase()}`,
    `Max size per trade: ${r.maxTradeSize}`,
    `Max total exposure: ${r.maxExposure}`,
    `Max leverage: ${r.maxLeverage}x`,
    `Markets: ${r.markets ? r.markets.join(",") : "all"}`,
    `Issued: ${r.issuedAt}`,
  ].join("\n");
}

export function copyUnfollowMessage(r: { follower: string; leader: string; issuedAt: number }): string {
  return `Zeno copy trading: stop\nFollower: ${r.follower.toLowerCase()}\nLeader: ${r.leader.toLowerCase()}\nIssued: ${r.issuedAt}`;
}
