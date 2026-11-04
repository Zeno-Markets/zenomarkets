/// Which protocol token the site may show as "CA". The token has not launched, so the answer is none
/// unless `live` is set (`NEXT_PUBLIC_PROTOCOL_TOKEN_LIVE=true`): the badge then reads "Coming Soon" on
/// every page, whatever address the deployment record or the environment holds. A malformed address is
/// ignored either way. When the token launches, set the flag; nothing else changes.
export function pickProtocolToken(input: {
  live: string | undefined;
  address: string | undefined;
  recordedAddress?: string;
  symbol?: string;
  recordedSymbol?: string;
}): { address: string; symbol: string } | undefined {
  if (input.live?.trim().toLowerCase() !== "true") return undefined;
  const address = (input.address || input.recordedAddress || "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  return { address, symbol: input.symbol?.trim() || input.recordedSymbol || "" };
}
