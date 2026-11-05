import { resolveChainId } from "@zeno/config";
import { pickProtocolToken } from "@/lib/protocolToken";

/// The ZENO token as the server knows it now, from `PROTOCOL_TOKEN_*` in the running process (web.env), so the CA
/// appears minutes after launch with a restart instead of a rebuild (deploy/vps-token.sh). `chainId` is the build's
/// network: the token belongs to it, not to a network picked in the browser.
export const dynamic = "force-dynamic";

export function GET() {
  const token = pickProtocolToken({
    live: process.env.PROTOCOL_TOKEN_LIVE,
    address: process.env.PROTOCOL_TOKEN_ADDRESS,
    symbol: process.env.PROTOCOL_TOKEN_SYMBOL,
  });
  return Response.json({ chainId: resolveChainId(process.env.NEXT_PUBLIC_CHAIN_ID), token: token ?? null }, { headers: { "Cache-Control": "no-store" } });
}
