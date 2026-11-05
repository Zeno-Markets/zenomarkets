#!/usr/bin/env bash
# Run from the repo root:  bash scripts/mainnet-v1.sh [--broadcast]
# ZENOMARKETS V1.0 contracts on Robinhood Chain mainnet (4663), signed by the one deployer wallet (docs/RELEASES.md):
#   1  swap ETH for the pool's USDG on the Uniswap v3 WETH / USDG pool
#   2  DeployAll: a fresh stack on the real USDG
#   3  the 39 markets of deployments/robinhood_mainnet.markets.json, then the launch caps of .limits.json
#   4  fund the trading pool with caps.poolReserveRaw
#   5  the buyback: fee manager -> buyback module, BUYBACK_SHARE_BPS of each fee (ZENO itself is set once it launches)
#   6  check the on-chain limits, then record the addresses in packages/config (scripts/record-deployment.mjs)
# Without --broadcast: checks the chain and the balance against today's gas price and dry-runs DeployAll; nothing is
# sent. With --broadcast: asks the keystore password once (kept in a private temp file, deleted on exit), checks the
# address, then sends. Safe to run again after a failure: a finished step is skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
DEPLOYER="0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C"
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/deployer}"
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
POOL=0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca # Uniswap v3 WETH / USDG, 0.01%
BUYBACK_SHARE_BPS="${BUYBACK_SHARE_BPS:-1000}"
# Gas the whole run used on a mainnet fork (rehearsal 2026-11-06: 89.9M over 483 transactions), plus the swap and
# the buyback calls. Robinhood Chain charges no L1 data component (NodeInterface.gasEstimateL1Component is 0).
GAS_V1=91000000
export NETWORK_NAME=robinhood_mainnet
unset PRIVATE_KEY # every forge step signs with the keystore below, never a key from the environment

[ "$(cast chain-id --rpc-url "$RPC")" = "4663" ] || { echo "RPC is not Robinhood Chain mainnet (4663)"; exit 1; }
cd "$ROOT/packages/contracts"
forge build -q
DEPLOYED=deployments/$NETWORK_NAME.json
RAW="$(jq .caps.poolReserveRaw deployments/$NETWORK_NAME.limits.json)"

# What is done already, read from the chain, so a second run picks up where the first stopped.
stack_live=false
if [ -f "$DEPLOYED" ]; then
  for address in $(jq -r '.[]' "$DEPLOYED"); do
    if [ "$(cast code "$address" --rpc-url "$RPC")" = "0x" ]; then
      echo "STOP: $DEPLOYED lists $address, which has no code: DeployAll was sent only in part."
      echo "      Finish it with: forge script script/DeployAll.s.sol:DeployAll --resume (same signer flags), then rerun."
      exit 1
    fi
  done
  stack_live=true
fi
pool_funded() { $stack_live && [ "$(cast call "$(jq -r .vault "$DEPLOYED")" "poolBalance(address)(uint256)" "$USDG" --rpc-url "$RPC" | awk '{print $1}')" -ge "$RAW" ]; }
usdg_held() { cast call "$USDG" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC" | awk '{print $1}'; }

# ETH for the pool's USDG at the pool's price now, 2% over so MIN_OUT (the exact reserve) holds through the fill.
sqrt="$(cast call "$POOL" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url "$RPC" | head -1 | awk '{print $1}')"
swap_wei=0
if ! pool_funded && [ "$(usdg_held)" -lt "$RAW" ]; then
  swap_wei="$(node -e "console.log(((BigInt('$RAW') - BigInt('$(usdg_held)')) * 102n * (1n << 192n) / (100n * BigInt('$sqrt') ** 2n) + 1n).toString())")"
fi
balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
gas_price="$(cast gas-price --rpc-url "$RPC")"
# 25% over today's gas price: a run that stops halfway leaves a stack nobody can use and the ETH spent.
need="$(node -e "console.log((BigInt('$GAS_V1') * BigInt('$gas_price') * 125n / 100n + BigInt('$swap_wei')).toString())")"
echo "deployer   $DEPLOYER"
echo "balance    $(cast from-wei "$balance") ETH, $(usdg_held) USDG base units"
echo "gas price  $(cast from-wei "$gas_price" gwei) gwei"
echo "pool       $RAW USDG base units; swap $(cast from-wei "$swap_wei") ETH for it"
echo "needed     $(cast from-wei "$need") ETH (gas +25% and the swap)"
if [ "$(node -e "console.log(BigInt('$balance') < BigInt('$need'))")" = true ]; then
  echo "STOP: balance below what the run needs. Nothing was sent."; exit 1
fi

if [ "${1:-}" != "--broadcast" ]; then
  if $stack_live; then echo "Stack already deployed at $(jq -r .vault "$DEPLOYED") (vault); a broadcast resumes after it."; exit 0; fi
  echo "Dry run of DeployAll against live mainnet; nothing is sent."
  COLLATERAL_TOKEN="$USDG" forge script script/DeployAll.s.sol:DeployAll --rpc-url "$RPC" --sender "$DEPLOYER" | grep -E "Script ran successfully|Estimated|ZenoVault|ZenoPerpsEngine|Option quoter" || true
  rm -f "$DEPLOYED" "deployments/$NETWORK_NAME.implementations.json" # the simulation writes them; only a broadcast may
  exit 0
fi

PW="$(mktemp)"; chmod 600 "$PW"; trap 'rm -f "$PW"' EXIT
read -rsp "Keystore password for 'deployer': " pass; echo
printf '%s' "$pass" >"$PW"; unset pass
ADDR="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PW")"
if [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" ]; then
  echo "STOP: keystore is $ADDR, expected $DEPLOYER. Nothing was sent."; exit 1
fi
echo "keystore ok"
COMMON=(--rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PW" --sender "$DEPLOYER" --broadcast --slow)
SEND=(--rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PW")

echo "1/6  USDG for the pool"
if [ "$swap_wei" = 0 ]; then echo "     held already"; else
  SWAP_ETH_WEI="$swap_wei" MIN_OUT="$RAW" POOL="$POOL" WETH="$WETH" forge script script/SwapEthForUsdg.s.sol "${COMMON[@]}" | grep "USDG received" || true
  [ "$(usdg_held)" -ge "$RAW" ] || { echo "STOP: the swap did not deliver $RAW USDG base units"; exit 1; }
fi

echo "2/6  core stack"
if $stack_live; then echo "     deployed already"; else
  COLLATERAL_TOKEN="$USDG" forge script script/DeployAll.s.sol:DeployAll "${COMMON[@]}" >/dev/null
  stack_live=true
fi
echo "     vault $(jq -r .vault "$DEPLOYED")"

echo "3/6  markets and launch caps"
MAX_POSITION=1 OPEN_INTEREST_CAP=1 MAX_PRICE_AGE_HOURS=25 forge script script/AddMarketsMainnet.s.sol "${COMMON[@]}" >/dev/null
forge script script/SetLaunchCaps.s.sol "${COMMON[@]}" >/dev/null
echo "     $(cast call "$(jq -r .marketRegistry "$DEPLOYED")" "allMarketIds()(bytes32[])" --rpc-url "$RPC" | tr ',' '\n' | grep -c 0x) markets listed"

echo "4/6  pool"
if pool_funded; then echo "     funded already"; else
  AMOUNT_RAW="$RAW" forge script script/FundPool.s.sol "${COMMON[@]}" | grep "Pool balance" || true
fi

echo "5/6  buyback share"
FEE="$(jq -r .feeManager "$DEPLOYED")" BUYBACK="$(jq -r .buybackModule "$DEPLOYED")"
[ "$(cast call "$FEE" "buybackModule()(address)" --rpc-url "$RPC" | tr 'A-F' 'a-f')" = "$(echo "$BUYBACK" | tr 'A-F' 'a-f')" ] ||
  cast send "$FEE" "setBuybackModule(address)" "$BUYBACK" "${SEND[@]}" >/dev/null
[ "$(cast call "$FEE" "buybackShareBps()(uint256)" --rpc-url "$RPC" | awk '{print $1}')" = "$BUYBACK_SHARE_BPS" ] ||
  cast send "$FEE" "setBuybackShare(uint256)" "$BUYBACK_SHARE_BPS" "${SEND[@]}" >/dev/null
echo "     $BUYBACK_SHARE_BPS bps of each fee to $BUYBACK"

echo "6/6  check and record"
RPC_URL="$RPC" MAX_POSITION=1 MAX_OPEN_INTEREST=1 MAX_NET_OPEN_INTEREST=1 MAX_LEVERAGE=10 ./script/check-launch-limits.sh "$NETWORK_NAME" | tail -2
cd "$ROOT" && node scripts/record-deployment.mjs "$NETWORK_NAME"
echo "done. Spent: $(cast from-wei "$(node -e "console.log((BigInt('$balance') - BigInt('$(cast balance "$DEPLOYER" --rpc-url "$RPC")')).toString())")") ETH"
