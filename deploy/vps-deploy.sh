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
case "$NET" in
  testnet) SITE=https://testnet.zenomarkets.tech RPC=https://rpc.testnet.chain.robinhood.com EXPLORER=https://explorer.testnet.chain.robinhood.com ;;
  mainnet) SITE=https://zenomarkets.tech RPC=https://rpc.mainnet.chain.robinhood.com EXPLORER=https://robinhoodchain.blockscout.com ;;
esac
as_zeno env NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 \
  NEXT_PUBLIC_CHAIN_ID="$CHAIN_ID" NEXT_PUBLIC_SITE_URL="$SITE" NEXT_PUBLIC_API_URL="$SITE" \
  NEXT_PUBLIC_RPC_URL="$RPC" NEXT_PUBLIC_RPC_PROXY_URL="$SITE/v1/rpc" NEXT_PUBLIC_EXPLORER_URL="$EXPLORER" \
  NEXT_PUBLIC_RELEASE="${RELEASE:-}" RELEASE_VERSION="${RELEASE_VERSION:-}" \
  NEXT_PUBLIC_PROTOCOL_TOKEN_LIVE="${PROTOCOL_TOKEN_LIVE:-}" NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS="${PROTOCOL_TOKEN_ADDRESS:-}" \
  NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL="${PROTOCOL_TOKEN_SYMBOL:-}" \
  corepack pnpm --filter @zeno/web build

for svc in "${SERVICES[@]}"; do systemctl enable --quiet "zeno-$svc@$NET"; systemctl restart "zeno-$svc@$NET"; done
systemctl enable --quiet "zeno-web@$NET"; systemctl restart "zeno-web@$NET"
sleep 8
for unit in "${SERVICES[@]/#/zeno-}" zeno-web; do printf '%-22s %s\n' "$unit@$NET" "$(systemctl is-active "$unit@$NET")"; done
