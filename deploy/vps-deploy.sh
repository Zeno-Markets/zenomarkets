#!/usr/bin/env bash
# Deploys the latest commit of a network's branch on the VPS. Run as root on the VPS:
#   bash /opt/zeno/testnet/repo/deploy/vps-deploy.sh testnet
# Pulls, installs, migrates the database, builds the web app and restarts every ZENOMARKETS service of that network.
# Git runs as the `zeno` user only: a root-owned file in the checkout breaks the services.
set -euo pipefail
NET="${1:?usage: vps-deploy.sh testnet|mainnet}"
BASE=/opt/zeno/$NET
REPO=$BASE/repo
SERVICES=(api indexer keeper pricing risk-monitor)
as_zeno() { sudo -u zeno env HOME=/home/zeno PATH="$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"; }

as_zeno git -C "$REPO" fetch --quiet origin "$NET"
as_zeno git -C "$REPO" reset --quiet --hard "origin/$NET"
echo "commit $(as_zeno git -C "$REPO" log -1 --format='%h %s')"

cd "$REPO"
as_zeno corepack pnpm install --frozen-lockfile --prod=false --silent

set -a; . "$BASE/zeno.env"; set +a
as_zeno env DATABASE_URL="$DATABASE_URL" corepack pnpm --filter @zeno/indexer db:migrate
as_zeno env DATABASE_URL="$DATABASE_URL" corepack pnpm --filter @zeno/risk-monitor db:migrate

# The web build reads only NEXT_PUBLIC_* values: the network's public endpoints, nothing secret.
# zeno.env's RELEASE (the roadmap release mainnet runs; testnet runs every one) and PROTOCOL_TOKEN_* (the ZENO
# address shown as CA once PROTOCOL_TOKEN_LIVE=true) reach the build here: sudo drops the rest. See docs/RELEASES.md.
# Both networks' endpoints go into every build: the network menu switches a site to the other network, and without
# the other network's values that site reads from nowhere ("Could not read markets from the chain").
TESTNET_SITE=https://testnet.zenomarkets.tech TESTNET_RPC=https://rpc.testnet.chain.robinhood.com TESTNET_EXPLORER=https://explorer.testnet.chain.robinhood.com
MAINNET_SITE=https://zenomarkets.tech MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com MAINNET_EXPLORER=https://robinhoodchain.blockscout.com
case "$NET" in
  testnet) SITE=$TESTNET_SITE RPC=$TESTNET_RPC EXPLORER=$TESTNET_EXPLORER OTHER_SITE=$MAINNET_SITE ;;
  mainnet) SITE=$MAINNET_SITE RPC=$MAINNET_RPC EXPLORER=$MAINNET_EXPLORER OTHER_SITE=$TESTNET_SITE ;;
esac
# The other site, switched to this network, calls this API from its own origin: let it through CORS (idempotent).
if ! grep -q "^CORS_ORIGINS=.*$OTHER_SITE" "$BASE/zeno.env"; then
  if grep -q '^CORS_ORIGINS=' "$BASE/zeno.env"; then sed -i "s|^CORS_ORIGINS=.*|&,$OTHER_SITE|" "$BASE/zeno.env"
  else echo "CORS_ORIGINS=$SITE,$OTHER_SITE" >>"$BASE/zeno.env"; fi
fi
as_zeno env NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 \
  NEXT_PUBLIC_CHAIN_ID="$CHAIN_ID" NEXT_PUBLIC_SITE_URL="$SITE" NEXT_PUBLIC_API_URL="$SITE" \
  NEXT_PUBLIC_RPC_URL="$RPC" NEXT_PUBLIC_RPC_PROXY_URL="$SITE/v1/rpc" NEXT_PUBLIC_EXPLORER_URL="$EXPLORER" \
  NEXT_PUBLIC_RPC_URL_TESTNET="$TESTNET_RPC" NEXT_PUBLIC_RPC_PROXY_URL_TESTNET="$TESTNET_SITE/v1/rpc" \
  NEXT_PUBLIC_EXPLORER_URL_TESTNET="$TESTNET_EXPLORER" NEXT_PUBLIC_API_URL_TESTNET="$TESTNET_SITE" \
  NEXT_PUBLIC_RPC_URL_MAINNET="$MAINNET_RPC" NEXT_PUBLIC_RPC_PROXY_URL_MAINNET="$MAINNET_SITE/v1/rpc" \
  NEXT_PUBLIC_EXPLORER_URL_MAINNET="$MAINNET_EXPLORER" NEXT_PUBLIC_API_URL_MAINNET="$MAINNET_SITE" \
  NEXT_PUBLIC_RELEASE="${RELEASE:-}" RELEASE_VERSION="${RELEASE_VERSION:-}" \
  NEXT_PUBLIC_PROTOCOL_TOKEN_LIVE="${PROTOCOL_TOKEN_LIVE:-}" NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS="${PROTOCOL_TOKEN_ADDRESS:-}" \
  NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL="${PROTOCOL_TOKEN_SYMBOL:-}" \
  corepack pnpm --filter @zeno/web build

for svc in "${SERVICES[@]}"; do systemctl enable --quiet "zeno-$svc@$NET"; systemctl restart "zeno-$svc@$NET"; done
systemctl enable --quiet "zeno-web@$NET"; systemctl restart "zeno-web@$NET"
sleep 8
for unit in "${SERVICES[@]/#/zeno-}" zeno-web; do printf '%-22s %s\n' "$unit@$NET" "$(systemctl is-active "$unit@$NET")"; done
