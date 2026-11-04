#!/usr/bin/env bash
# Fails unless the pages served at $1 (default https://zenomarkets.tech) carry the ZENO CA: $2, else the token
# recorded in packages/config. Run by both web deploy scripts as their last step.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:-https://zenomarkets.tech}"
ca="${2:-$(grep -A1 'protocolTokens:' packages/config/src/deployments.ts | grep -oE '0x[0-9a-fA-F]{40}')}"
for page in "" markets features; do
  body="$(curl -fsS "$host/$page?v=$(date +%s)")"
  grep -qi "$ca" <<<"$body" || { echo "FAIL: CA $ca missing on $host/$page" >&2; exit 1; }
done
echo "CA $ca live on $host: /, /markets, /features"
