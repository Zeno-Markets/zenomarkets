#!/usr/bin/env bash
# Run from the repo root:  bash scripts/mainnet-v2.sh [--broadcast]
# ZENOMARKETS V2.0 contracts on Robinhood Chain mainnet (4663), signed by the deployer wallet (docs/RELEASES.md, V2.0):
#   1  DeployCreditStack: oracle, registry, router, vault and the TSLA/USDG pair, the pair open (CREDIT_PAUSED=false)
#   2  the lending vault takes deposits (it is deployed with them paused)
#   3  the RFQ market maker (the deployer) holds MAKER_ROLE on ZenoRFQManager
#   4  record the credit addresses in packages/config (scripts/record-deployment.mjs)
# Without --broadcast: checks the chain and the balance and dry-runs DeployCreditStack; nothing is sent.
# With --broadcast: asks the keystore password once (private temp file, deleted on exit), checks the address, sends.
# Safe to run again after a failure: a finished step is skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
DEPLOYER="0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C"
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/deployer}"
TSLA=0x322F0929c4625eD5bAd873c95208D54E1c003b2d
# Dry run 2026-11-06: 11.08M gas for DeployCreditStack; the vault call and the margin on top.
GAS_V2=12000000
export NETWORK_NAME=robinhood_mainnet CREDIT_COLLATERAL_TOKEN=$TSLA CREDIT_PAUSED=false
unset PRIVATE_KEY # every forge step signs with the keystore below, never a key from the environment

[ "$(cast chain-id --rpc-url "$RPC")" = "4663" ] || { echo "RPC is not Robinhood Chain mainnet (4663)"; exit 1; }
cd "$ROOT/packages/contracts"
forge build -q
DEPLOYED=deployments/$NETWORK_NAME.json
[ "$(jq -r '.vault // empty' "$DEPLOYED")" ] || { echo "STOP: no V1.0 stack in $DEPLOYED"; exit 1; }
lower() { tr 'A-F' 'a-f'; }

credit_live=false
pair="$(jq -r '.creditPairTslaUsdg // empty' "$DEPLOYED")"
if [ -n "$pair" ]; then
  for key in creditOracle creditRegistry creditRouter creditVault creditPairTslaUsdg; do
    [ "$(cast code "$(jq -r ".$key" "$DEPLOYED")" --rpc-url "$RPC")" != "0x" ] || { echo "STOP: $key in $DEPLOYED has no code: DeployCreditStack was sent only in part. Finish it with --resume, then rerun."; exit 1; }
  done
  credit_live=true
fi

balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
gas_price="$(cast gas-price --rpc-url "$RPC")"
gas_left=$GAS_V2; $credit_live && gas_left=200000
need="$(node -e "console.log((BigInt('$gas_left') * BigInt('$gas_price') * 125n / 100n).toString())")"
echo "deployer   $DEPLOYER"
echo "balance    $(cast from-wei "$balance") ETH"
echo "gas price  $(cast from-wei "$gas_price" gwei) gwei"
echo "needed     $(cast from-wei "$need") ETH (gas +25%)"
if [ "$(node -e "console.log(BigInt('$balance') < BigInt('$need'))")" = true ]; then
  echo "STOP: balance below what the run needs. Nothing was sent."; exit 1
fi

if [ "${1:-}" != "--broadcast" ]; then
  if $credit_live; then echo "Credit stack already deployed (pair $pair); a broadcast resumes after it."; exit 0; fi
  echo "Dry run of DeployCreditStack against live mainnet; nothing is sent."
  cp "$DEPLOYED" "$DEPLOYED.bak"; trap 'mv "$DEPLOYED.bak" "$DEPLOYED"' EXIT # the simulation writes the record; only a broadcast may
  forge script script/DeployCreditStack.s.sol:DeployCreditStack --rpc-url "$RPC" --sender "$DEPLOYER" | grep -E "Script ran successfully|Estimated total gas|Paused:|ZenoCredit|ZenoComposite" || true
  exit 0
fi

PW="$(mktemp)"; chmod 600 "$PW"; trap 'rm -f "$PW"' EXIT
read -rsp "Keystore password for 'deployer': " pass; echo
printf '%s' "$pass" >"$PW"; unset pass
ADDR="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PW")"
[ "$(echo "$ADDR" | lower)" = "$(echo "$DEPLOYER" | lower)" ] || { echo "STOP: keystore is $ADDR, expected $DEPLOYER. Nothing was sent."; exit 1; }
echo "keystore ok"
COMMON=(--rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PW" --sender "$DEPLOYER" --broadcast --slow)
SEND=(--rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PW")

echo "1/4  credit stack"
if $credit_live; then echo "     deployed already"; else
  forge script script/DeployCreditStack.s.sol:DeployCreditStack "${COMMON[@]}" >/dev/null
fi
VAULT="$(jq -r .creditVault "$DEPLOYED")" REGISTRY="$(jq -r .creditRegistry "$DEPLOYED")"
echo "     pair $(jq -r .creditPairTslaUsdg "$DEPLOYED")"

echo "2/4  lending vault deposits"
[ "$(cast call "$VAULT" "depositsPaused()(bool)" --rpc-url "$RPC")" = false ] ||
  cast send "$VAULT" "setDepositsPaused(bool)" false "${SEND[@]}" >/dev/null
echo "     open at $VAULT"

echo "3/4  RFQ market maker"
RFQ="$(jq -r .rfqManager "$DEPLOYED")"
ROLE="$(cast call "$RFQ" "MAKER_ROLE()(bytes32)" --rpc-url "$RPC")"
[ "$(cast call "$RFQ" "hasRole(bytes32,address)(bool)" "$ROLE" "$DEPLOYER" --rpc-url "$RPC")" = true ] ||
  { echo "STOP: $DEPLOYER does not hold MAKER_ROLE on $RFQ"; exit 1; }
echo "     $DEPLOYER holds MAKER_ROLE"

echo "4/4  record"
(cd "$ROOT" && RPC_URL="$RPC" node scripts/record-deployment.mjs "$NETWORK_NAME")
echo "     $(cast call "$REGISTRY" "getMarketCount()(uint256)" --rpc-url "$RPC") lending market(s) listed"
echo "done. Spent: $(cast from-wei "$(node -e "console.log((BigInt('$balance') - BigInt('$(cast balance "$DEPLOYER" --rpc-url "$RPC")')).toString())")") ETH"
echo "next: RELEASE=2 in /opt/zeno/mainnet/zeno.env, push main to mainnet, vps-deploy.sh mainnet (docs/RELEASES.md V2.0 step 4)"
