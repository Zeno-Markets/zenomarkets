#!/usr/bin/env bash
# Shows the ZENO token's contract address (CA) on a network's site in seconds, without a rebuild. Run as root on the VPS:
#   bash /opt/zeno/mainnet/repo/deploy/vps-token.sh mainnet 0x...ZENO [ZENO]
# Refuses an address with no contract behind it on that network, writes PROTOCOL_TOKEN_* to web.env (read by the
# running site through /api/protocol-token) and zeno.env (baked into the next vps-deploy.sh build), restarts only the
# web app, and checks the site now serves the address. Open tabs pick it up within a minute.
set -euo pipefail
NET="${1:?usage: vps-token.sh testnet|mainnet 0xADDRESS [SYMBOL]}"
ADDRESS="${2:?usage: vps-token.sh testnet|mainnet 0xADDRESS [SYMBOL]}"
SYMBOL="${3:-ZENO}"
BASE="${ZENO_BASE:-/opt/zeno/$NET}"
case "$NET" in
  testnet) SITE=https://testnet.zenomarkets.tech RPC=https://rpc.testnet.chain.robinhood.com ;;
  mainnet) SITE=https://zenomarkets.tech RPC=https://rpc.mainnet.chain.robinhood.com ;;
  *) echo "unknown network $NET"; exit 1 ;;
esac
[[ "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "not an address: $ADDRESS"; exit 1; }
[[ "$SYMBOL" =~ ^[A-Za-z0-9]{1,12}$ ]] || { echo "not a symbol: $SYMBOL"; exit 1; }

# A typo or an address from another chain has no code here: stop before the site shows it.
code=$(curl -fsS -m 20 -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"$ADDRESS\",\"latest\"]}" "$RPC" | grep -o '"result":"0x[0-9a-fA-F]*"' || true)
if [ -z "$code" ] || [ "$code" = '"result":"0x"' ]; then echo "no contract at $ADDRESS on $NET: nothing changed"; exit 1; fi

set_var() { # file key value: replace the line, or add it
  if grep -q "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >>"$1"; fi
}
for file in "$BASE/web.env" "$BASE/zeno.env"; do
  set_var "$file" PROTOCOL_TOKEN_LIVE true
  set_var "$file" PROTOCOL_TOKEN_ADDRESS "$ADDRESS"
  set_var "$file" PROTOCOL_TOKEN_SYMBOL "$SYMBOL"
done
[ -n "${ZENO_BASE:-}" ] && exit 0 # a test run on copies of the env files stops here

systemctl restart "zeno-web@$NET"
for _ in $(seq 1 30); do
  if curl -fsS -m 5 "$SITE/api/protocol-token" 2>/dev/null | grep -qi "$ADDRESS"; then
    echo "live: $SITE shows CA $ADDRESS ($SYMBOL)"; exit 0
  fi
  sleep 2
done
echo "the site does not serve $ADDRESS yet: check systemctl status zeno-web@$NET"; exit 1
