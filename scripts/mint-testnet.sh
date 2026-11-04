#!/usr/bin/env bash
# Mints testnet collateral to a wallet so it can be filmed: mUSDC (trading collateral) and mock TSLA
# (lending collateral). Both tokens have a public `mint`; the deployer pays the gas. The wallet still
# needs its own faucet ETH to sign (https://faucet.testnet.chain.robinhood.com).
# Usage: bash scripts/mint-testnet.sh 0xYourWallet [musdc=100000] [tsla=100]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.testnet; set +a
R=https://rpc.testnet.chain.robinhood.com
D=packages/contracts/deployments/robinhood_testnet.json
TO=${1:?usage: mint-testnet.sh 0xWallet [musdc] [tsla]}
cast to-check-sum-address "$TO" >/dev/null
USDC=$(jq -r .settlementToken "$D")
TSLA=$(cast call "$(jq -r .creditPairTslaUsdg "$D")" 'collateralToken()(address)' --rpc-url "$R")
for row in "$USDC ${2:-100000}" "$TSLA ${3:-100}"; do
  set -- $row
  cast send "$1" 'mint(address,uint256)' "$TO" "$(cast to-wei "$2")" --private-key "$PRIVATE_KEY" --rpc-url "$R" >/dev/null
  echo "minted $2 of $1 to $TO"
done
