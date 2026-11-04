#!/usr/bin/env bash
# Run from the repo root:  bash scripts/testnet-deploy.sh [--broadcast]
# Fresh ZENOMARKETS stack on Robinhood Chain Testnet (46630), signed by the one deployer wallet:
#   1  testnet USDG (settlement dollar, public mint up to 10,000 per call)
#   2  DeployAll: 20 UUPS proxies + implementations, every role wired
#   3  markets: stocks, ETFs, crypto, commodities, opened at today's real price (Yahoo Finance)
#   4  credit stack: TSLA / USDG lending pair, open
#   5  pool: the deployer funds the trading pool
# Without --broadcast: a dry run of step 2 against the live testnet, nothing sent.
# With --broadcast: asks the keystore password once (kept in a private temp file, deleted on exit), checks the
# address, sends every step, then records the addresses in packages/config (scripts/record-deployment.mjs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
DEPLOYER="0xd09D9c87ECfe008B4D6D3cEbeAd25103c16d9a7C"
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/deployer}"
MIN_BALANCE="${MIN_BALANCE:-2000000000000000}" # 0.002 ETH
POOL_USDG="${POOL_USDG:-250000}"
export NETWORK_NAME=robinhood_testnet

# SYMBOL|NAME|MAX_LEVERAGE|MAINTENANCE_BPS|MAX_POSITION|OI_CAP   (TSLA first: it is the lending collateral)
MARKETS=(
  "TSLA|Tesla|5|750|250000|3000000"
  "NVDA|NVIDIA|5|750|250000|3000000"
  "AAPL|Apple|5|750|250000|3000000"
  "MSFT|Microsoft|5|750|250000|3000000"
  "GOOGL|Alphabet|5|750|250000|3000000"
  "AMZN|Amazon|5|750|250000|3000000"
  "META|Meta Platforms|5|750|250000|3000000"
  "COIN|Coinbase|3|1000|250000|3000000"
  "MSTR|Strategy|3|1000|250000|3000000"
  "PLTR|Palantir|3|1000|250000|3000000"
  "AMD|AMD|5|750|250000|3000000"
  "SPY|SPDR S&P 500 ETF|10|500|500000|5000000"
  "QQQ|Invesco QQQ ETF|10|500|500000|5000000"
  "BTC|Bitcoin|5|750|250000|3000000"
  "ETH|Ether|5|750|250000|3000000"
  "LINK|Chainlink|5|750|250000|3000000"
  "GLD|SPDR Gold Trust|5|750|250000|3000000"
  "SLV|iShares Silver Trust|5|750|250000|3000000"
  "USO|United States Oil Fund|5|750|250000|3000000"
  "BABA|Alibaba|5|750|250000|3000000"
  "TSM|Taiwan Semiconductor|5|750|250000|3000000"
)

[ "$(cast chain-id --rpc-url "$RPC")" = "46630" ] || { echo "RPC is not Robinhood Chain Testnet (46630)"; exit 1; }
balance="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
echo "deployer balance: $(cast from-wei "$balance") ETH"
cd "$ROOT/packages/contracts"
forge build -q

# The real price of each instrument now, 18 decimals. Yahoo symbols follow packages/config (BTC -> BTC-USD).
price_wei() {
  local yahoo="$1"
  case "$yahoo" in BTC|ETH|LINK) yahoo="$yahoo-USD" ;; esac
  node -e "fetch('https://query1.finance.yahoo.com/v8/finance/chart/$yahoo?interval=1d&range=5d',{headers:{'user-agent':'Mozilla/5.0'}}).then(r=>r.json()).then(b=>{const p=b.chart.result[0].meta.regularMarketPrice;if(!(p>0))process.exit(1);console.log((BigInt(Math.round(p*1e8))*10n**10n).toString())}).catch(()=>process.exit(1))"
}

if [ "${1:-}" != "--broadcast" ]; then
  echo "Dry run of DeployAll against the live testnet; nothing is sent."
  COLLATERAL_TOKEN=0x000000000000000000000000000000000000dEaD forge script script/DeployAll.s.sol:DeployAll --rpc-url "$RPC" --sender "$DEPLOYER" | tail -25
  echo "Prices the markets would open at:"
  for row in "${MARKETS[@]}"; do IFS='|' read -r s _ <<<"$row"; printf '  %-5s %s\n' "$s" "$(cast from-wei "$(price_wei "$s")")"; done
  exit 0
fi

if [ "$(node -e "console.log(BigInt('$balance') < BigInt('$MIN_BALANCE'))")" = true ]; then
  echo "STOP: balance below $(cast from-wei "$MIN_BALANCE") ETH. Top up at https://faucet.testnet.chain.robinhood.com"
  exit 1
fi

if [ "${REHEARSAL:-}" = 1 ]; then
  # Fork rehearsal only (anvil --auto-impersonate on a testnet fork): no key involved.
  COMMON=(--rpc-url "$RPC" --unlocked --sender "$DEPLOYER" --broadcast --slow)
  SEND=(--rpc-url "$RPC" --unlocked --from "$DEPLOYER")
else
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
fi

echo "1/5  testnet USDG"
USDG="$(forge create src/testnet/ZenoTestToken.sol:ZenoTestToken "${SEND[@]}" --broadcast \
  --constructor-args "Global Dollar (ZENO testnet)" USDG 6 10000 | awk '/Deployed to:/ {print $3}')"
[ -n "$USDG" ] || { echo "USDG deploy failed"; exit 1; }
echo "     USDG $USDG"

echo "2/5  core stack"
COLLATERAL_TOKEN="$USDG" forge script script/DeployAll.s.sol:DeployAll "${COMMON[@]}" >/dev/null
REGISTRY="$(jq -r .marketRegistry deployments/$NETWORK_NAME.json)"
echo "     registry $REGISTRY"

echo "3/5  markets"
for row in "${MARKETS[@]}"; do
  IFS='|' read -r symbol name leverage maintenance maxpos oicap <<<"$row"
  id="$(cast format-bytes32-string "$symbol")"
  if cast call "$REGISTRY" "allMarketIds()(bytes32[])" --rpc-url "$RPC" | grep -qi "${id#0x}"; then echo "     $symbol listed already"; continue; fi
  wei="$(price_wei "$symbol")"
  SYMBOL="$symbol" NAME="$name" PRICE_WEI="$wei" MAX_LEVERAGE="$leverage" MAINTENANCE_MARGIN_BPS="$maintenance" \
    MAX_POSITION="$maxpos" OPEN_INTEREST_CAP="$oicap" forge script script/AddMarket.s.sol:AddMarket "${COMMON[@]}" >/dev/null
  echo "     $symbol at \$$(cast from-wei "$wei")"
done

echo "4/5  credit stack (TSLA / USDG)"
TSLA_ID="$(cast format-bytes32-string TSLA)"
TSLA="$(cast call "$REGISTRY" "getMarket(bytes32)((bytes32,address,bytes32,bool,bool,uint256,uint256,bool))" "$TSLA_ID" --rpc-url "$RPC" | sed -E 's/^\([^,]+, (0x[0-9a-fA-F]{40}).*/\1/')"
CREDIT_COLLATERAL_TOKEN="$TSLA" CREDIT_PAUSED=false forge script script/DeployCreditStack.s.sol:DeployCreditStack "${COMMON[@]}" >/dev/null
echo "     pair $(jq -r .creditPairTslaUsdg deployments/$NETWORK_NAME.json)"

echo "5/5  fund the trading pool with $POOL_USDG USDG"
for _ in $(seq 1 $(( (POOL_USDG + 9999) / 10000 ))); do
  cast send "$USDG" "mint(address,uint256)" "$DEPLOYER" 10000000000 "${SEND[@]}" >/dev/null
done
AMOUNT="$POOL_USDG" forge script script/FundPool.s.sol:FundPool "${COMMON[@]}" | grep "Pool balance" || true

cd "$ROOT" && node scripts/record-deployment.mjs robinhood_testnet
echo "done. Spent: $(cast from-wei "$(node -e "console.log((BigInt('$balance') - BigInt('$(cast balance "$DEPLOYER" --rpc-url "$RPC")')).toString())")") ETH"
