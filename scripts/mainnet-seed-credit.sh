#!/usr/bin/env bash
# Run from the repo root:  bash scripts/mainnet-seed-credit.sh [--broadcast]
# Seeds the mainnet TSLA/USDG lending pair, without which every borrow reverts, from the deployer's ETH. In one atomic
# call: ETH to USDG (Uniswap v3 WETH/USDG 0.01%), USDG to TSLA for a test position (TSLA/USDG 0.3%), USDG into the pair.
# The seed is the pair's borrowCap. The pair has no way to withdraw liquidity: a seed only leaves through a borrow.
# Without --broadcast: prints the plan and simulates it; nothing is sent.
# With --broadcast: asks the keystore password once (private temp file, deleted on exit), checks the address, sends.
# Safe to run again: it only buys what is missing, and stops when nothing is.
# REHEARSAL=1 MAINNET_RPC_URL=http://127.0.0.1:8545: the same run against an anvil fork of mainnet
# (anvil --fork-url <mainnet> --chain-id 4663 --auto-impersonate), signed without the keystore.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${MAINNET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
DEPLOYER="0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C"
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/deployer}"
export USDG=0x5fc5360D0400a0FD4f2aF552ADd042D716F1D168 WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
export TSLA=0x322F0929c4625eD5bAd873c95208D54E1c003b2d PAIR=0xbfB24E468fd1ec9006CBd7bA93eb5b25B8Cf922a
export WETH_POOL=0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca TSLA_POOL=0xf4ACdAEEB7022862A763C9B1B885e11191c889E3
ORACLE=0xEf9acbae2aAa3ED00A8F15Bc04E7723636E0C509
TSLA_TARGET=2600000000000000 # 0.0026 TSLA: a 0.0025 test position and a little room
GAS_BUDGET=1500000
unset PRIVATE_KEY # signs with the keystore below, never a key from the environment

[ "$(cast chain-id --rpc-url "$RPC")" = "4663" ] || { echo "RPC is not Robinhood Chain mainnet (4663)"; exit 1; }
num() { awk '{print $1}'; }
held() { cast call "$1" "balanceOf(address)(uint256)" "$2" --rpc-url "$RPC" | num; }
big() { node -e "console.log(($1).toString())"; }

export SEED_RAW TSLA_OUT MAX_USDG_FOR_TSLA SWAP_ETH_WEI
registry="$(cast call "$PAIR" "registry()(address)" --rpc-url "$RPC")"
market="$(cast call "$PAIR" "marketId()(bytes32)" --rpc-url "$RPC")"
cap="$(cast call "$registry" "markets(bytes32)(bytes32,string,address,address,address,address,uint8,uint8,uint256,uint256,uint256,uint256,uint256)" "$market" --rpc-url "$RPC" | tail -1 | num)"
in_pair="$(held "$USDG" "$PAIR")"
SEED_RAW="$(big "BigInt('$cap') > BigInt('$in_pair') ? BigInt('$cap') - BigInt('$in_pair') : 0n")"
tsla_held="$(held "$TSLA" "$DEPLOYER")"
TSLA_OUT="$(big "BigInt('$TSLA_TARGET') > BigInt('$tsla_held') ? BigInt('$TSLA_TARGET') - BigInt('$tsla_held') : 0n")"
price="$(cast call "$ORACLE" "getPrice(address)(uint256)" "$TSLA" --rpc-url "$RPC" | num)"
sqrt="$(cast call "$WETH_POOL" "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" --rpc-url "$RPC" | awk 'NR == 1 {print $1}')"
# The oracle price plus 3% (the pool's 0.3% fee and any gap to the oracle) is the most this will pay for the TSLA.
MAX_USDG_FOR_TSLA="$(big "BigInt('$TSLA_OUT') * BigInt('$price') * 103n / (100n * 10n ** 30n) + 1n")"
usdg_needed="$(big "BigInt('$SEED_RAW') + BigInt('$MAX_USDG_FOR_TSLA')")"
# ETH for that USDG at the pool's price now, 2% over; the change comes back as USDG.
SWAP_ETH_WEI="$(big "BigInt('$usdg_needed') * 102n * (1n << 192n) / (100n * BigInt('$sqrt') ** 2n) + 1n")"
balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
gas_price="$(cast gas-price --rpc-url "$RPC")"
need="$(big "BigInt('$GAS_BUDGET') * BigInt('$gas_price') * 125n / 100n + BigInt('$SWAP_ETH_WEI')")"

echo "deployer   $DEPLOYER, $(cast from-wei "$balance") ETH"
echo "pair USDG  $in_pair of $cap base units; seed $SEED_RAW"
echo "TSLA       holds $(cast from-wei "$tsla_held"), buys $(cast from-wei "$TSLA_OUT"), pays at most $MAX_USDG_FOR_TSLA USDG base units"
echo "swap       $(cast from-wei "$SWAP_ETH_WEI") ETH"
echo "ETH left   about $(cast from-wei "$(big "BigInt('$balance') - BigInt('$need')")") after gas"
[ "$SEED_RAW" != 0 ] || { echo "Pair already holds its seed. Nothing to do."; exit 0; }
[ "$(big "BigInt('$balance') >= BigInt('$need')")" = true ] || { echo "STOP: balance below what the run needs. Nothing was sent."; exit 1; }

cd "$ROOT/packages/contracts"
forge build -q
SCRIPT=(script/SeedCreditPair.s.sol:SeedCreditPair --rpc-url "$RPC" --sender "$DEPLOYER")
if [ "${REHEARSAL:-}" = 1 ]; then
  case "$RPC" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "STOP: REHEARSAL=1 runs only against a local fork"; exit 1 ;; esac
  forge script "${SCRIPT[@]}" --unlocked --broadcast --slow | grep -E "Pair USDG|ONCHAIN EXECUTION COMPLETE" || true
elif [ "${1:-}" != "--broadcast" ]; then
  echo "Simulation; nothing is sent."
  forge script "${SCRIPT[@]}" | grep -E "Script ran successfully|Pair USDG|Estimated total gas|Error" || true
  exit 0
else
  PW="$(mktemp)"; chmod 600 "$PW"; trap 'rm -f "$PW"' EXIT
  read -rsp "Keystore password for 'deployer': " pass; echo
  printf '%s' "$pass" >"$PW"; unset pass
  ADDR="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PW")"
  [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" = "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" ] || { echo "STOP: keystore is $ADDR, expected $DEPLOYER. Nothing was sent."; exit 1; }
  echo "keystore ok"
  forge script "${SCRIPT[@]}" --keystore "$KEYSTORE" --password-file "$PW" --broadcast --slow | grep -E "Pair USDG|ONCHAIN EXECUTION COMPLETE" || true
fi

left="$(held "$USDG" "$PAIR")"
[ "$left" -ge "$cap" ] || { echo "STOP: the pair holds $left USDG base units, under its cap of $cap"; exit 1; }
echo "done. Pair USDG $left; deployer TSLA $(cast from-wei "$(held "$TSLA" "$DEPLOYER")"), USDG $(held "$USDG" "$DEPLOYER"), ETH $(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether)"
