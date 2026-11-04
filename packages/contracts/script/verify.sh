#!/usr/bin/env bash
# Verifies every contract on the Blockscout explorer, so a redeploy needs no address editing here.
# The protocol contracts are proxies: the code to verify is the implementation behind each proxy, listed in
# deployments/<NETWORK_NAME>.implementations.json (written by DeployAll and UpgradeAll). The proxy addresses
# in deployments/<NETWORK_NAME>.json are the ones users see; Blockscout recognizes an ERC-1967 proxy once
# its implementation is verified. Set NVDA_TOKEN / NVDA_FEED (printed by
# ConfigureMarkets.s.sol) to verify the mock market contracts too.
# Requires: ROBINHOOD_TESTNET_RPC_URL, EXPLORER_VERIFY_URL (from .env), jq.
# Uses --guess-constructor-args so forge reads the real deployment tx from chain and decodes
# constructor args itself — no manual ABI encoding needed.
#
# A failed request with an expired or unrelated TLS certificate usually means the network blocks the
# explorer: some Indonesian ISPs redirect it to a block page ("internetpositif"), even for 1.1.1.1.
# Resolve the real address over DNS-over-HTTPS and pin it in /etc/hosts while this runs, or use a VPN
# (steps in DEVELOPMENT_STEPS.md, Hosting). Each contract is retried (VERIFY_ATTEMPTS, default 3).
# --skip-is-verified-check makes forge submit even when Blockscout lists a look-alike contract as
# already verified (same bytecode from an older deployment), which is not a real verification.
# The script is safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .env ]]; then source .env; fi

file="deployments/${NETWORK_NAME:-robinhood_testnet}.json"
impl_file="deployments/${NETWORK_NAME:-robinhood_testnet}.implementations.json"
attempts="${VERIFY_ATTEMPTS:-3}"

# "verified" only for a real match: a look-alike (verified twin) still gets submitted, see the note above.
explorer="${EXPLORER_VERIFY_URL%/}"
explorer="${explorer%/api}"
status() {
  curl -s -m 30 "$explorer/api/v2/smart-contracts/$1" |
    jq -r 'if .is_verified == true and (.is_verified_via_verified_twin != true) then "verified" else "unverified" end' 2>/dev/null ||
    echo unverified
}

# Sends the standard JSON input straight to Blockscout, for a contract compiled in the `credit-via-ir` profile.
# `forge verify-contract --compilation-profile credit-via-ir` rejects such a contract with "Local bytecode doesn't
# match on-chain bytecode" even when the bytecode is identical, so forge's own check is skipped here. The
# remappings are replaced by the ones solc recorded, so Blockscout reports a full match (see verify-full.sh).
verify_api() {
  local address="$1" contract="$2" profile="$3"
  local source="${contract%%:*}" name="${contract##*:}"
  local artifact="out/$(basename "$source")/${name}.${profile}.json"
  local input="${TMPDIR:-/tmp}/verify-api-${name}.json"
  [[ -f "$artifact" ]] || return 1
  EXPLORER_API_KEY="${EXPLORER_API_KEY:-none}" forge verify-contract "$address" "$contract" \
    --show-standard-json-input --compilation-profile "$profile" 2>/dev/null |
    jq --slurpfile remappings <(jq '.metadata.settings.remappings' "$artifact") \
      '.settings.remappings = $remappings[0]' >"$input" || return 1
  curl -s -m 60 -X POST "$explorer/api" \
    --data-urlencode module=contract --data-urlencode action=verifysourcecode \
    --data-urlencode codeformat=solidity-standard-json-input \
    --data-urlencode "contractaddress=$address" --data-urlencode "contractname=$contract" \
    --data-urlencode "compilerversion=v$(jq -r '.metadata.compiler.version' "$artifact")" \
    --data-urlencode licenseType=3 --data-urlencode "sourceCode@$input" >/dev/null || return 1
  for ((poll = 1; poll <= 12; poll++)); do
    sleep 5
    [[ "$(status "$address")" == "verified" ]] && return 0
  done
  return 1
}

# verify <address> <path:Contract> [forge compilation profile] [api]
# With "api" as the 4th argument the contract goes through verify_api instead of forge.
verify() {
  local address="$1"
  local contract="$2"
  local profile=()
  if [[ -n "${3:-}" ]]; then profile=(--compilation-profile "$3"); fi
  echo "==> $contract at $address"
  if [[ "$(cast code "$address" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")" == "0x" ]]; then
    echo "!!! NOT PUBLISHED: no code at $address"
    return
  fi
  if [[ "$(status "$address")" == "verified" ]]; then
    echo "    [published & verified] already on the explorer, skipped"
    return 0
  fi
  for ((try = 1; try <= attempts; try++)); do
    if [[ "${4:-}" == "api" ]]; then
      if verify_api "$address" "$contract" "$3"; then
        echo "    [published & verified]"
        return 0
      fi
    elif forge verify-contract "$address" "$contract" \
      --chain-id "$(cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")" \
      --verifier blockscout \
      --verifier-url "$EXPLORER_VERIFY_URL" \
      --guess-constructor-args \
      --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" \
      --skip-is-verified-check \
      "${profile[@]}" \
      --watch; then
      echo "    [published & verified]"
      return 0
    fi
    sleep 3
  done
  echo "!!! FAILED: $contract at $address"
}

addr() { jq -er ".$1" "$file"; }
impl() { jq -er ".$1" "$impl_file"; }

verify "$(impl marketRegistry)" src/core/ZenoMarketRegistry.sol:ZenoMarketRegistry
verify "$(impl collateralManager)" src/core/ZenoCollateralManager.sol:ZenoCollateralManager
verify "$(impl vault)" src/core/ZenoVault.sol:ZenoVault
verify "$(impl feeManager)" src/core/ZenoFeeManager.sol:ZenoFeeManager
verify "$(impl buybackModule)" src/core/ZenoBuybackModule.sol:ZenoBuybackModule
verify "$(impl priceValidator)" src/oracle/ZenoPriceValidator.sol:ZenoPriceValidator
verify "$(impl oracleRouter)" src/oracle/ZenoOracleRouter.sol:ZenoOracleRouter
verify "$(impl riskManager)" src/risk/ZenoRiskManager.sol:ZenoRiskManager
verify "$(impl optionPositionManager)" src/options/ZenoOptionPositionManager.sol:ZenoOptionPositionManager
verify "$(impl optionMarket)" src/options/ZenoOptionMarket.sol:ZenoOptionMarket
verify "$(impl optionsEngine)" src/options/ZenoOptionsEngine.sol:ZenoOptionsEngine
verify "$(impl perpPositionManager)" src/perps/ZenoPerpPositionManager.sol:ZenoPerpPositionManager
verify "$(impl fundingManager)" src/perps/ZenoFundingManager.sol:ZenoFundingManager
verify "$(impl perpsEngine)" src/perps/ZenoPerpsEngine.sol:ZenoPerpsEngine
verify "$(impl liquidationEngine)" src/perps/ZenoLiquidationEngine.sol:ZenoLiquidationEngine
verify "$(impl perpOrderManager)" src/perps/ZenoPerpOrderManager.sol:ZenoPerpOrderManager
verify "$(impl insuranceFund)" src/core/ZenoInsuranceFund.sol:ZenoInsuranceFund
verify "$(impl crossMargin)" src/risk/ZenoCrossMarginManager.sol:ZenoCrossMarginManager
verify "$(impl subaccountFactory)" src/accounts/ZenoSubaccountFactory.sol:ZenoSubaccountFactory
verify "$(impl rfqManager)" src/perps/ZenoRFQManager.sol:ZenoRFQManager
# Prints "api" when the code at $1 equals the credit-via-ir build in artifact $2, else "forge". The credit stack
# is compiled in that profile (see verify_api); everything else uses the default profile through forge.
route() {
  local chain ir
  chain="$(cast code "$1" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" | tr -d '[:space:]' | sed 's/^0x//')"
  ir="$(jq -r '.deployedBytecode.object' "$2" 2>/dev/null | sed 's/^0x//')"
  if [[ -n "$ir" && "$chain" == "$ir" ]]; then echo api; else echo forge; fi
}
# verify_routed <address> <path:Contract> <artifact of the credit-via-ir build>
verify_routed() {
  if [[ "$(route "$1" "$3")" == api ]]; then verify "$1" "$2" credit-via-ir api; else verify "$1" "$2" default; fi
}

# Testnet assets: the settlement dollar, and every market's token and price feed (read from the registry).
if [[ -z "${SKIP_MOCKS:-}" ]] && [[ "$(cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")" == 46630 ]]; then
  verify "$(addr settlementToken)" src/testnet/ZenoTestToken.sol:ZenoTestToken
  for id in $(cast call "$(addr marketRegistry)" "allMarketIds()(bytes32[])" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" | tr -d '[],'); do
    token="$(cast call "$(addr marketRegistry)" "getMarket(bytes32)((bytes32,address,bytes32,bool,bool,uint256,uint256,bool))" "$id" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" | sed -E 's/^\([^,]+, (0x[0-9a-fA-F]{40}).*/\1/')"
    feed="$(cast call "$(addr oracleRouter)" "primarySource(bytes32)(address)" "$id" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")"
    verify "$token" src/testnet/ZenoTestToken.sol:ZenoTestToken </dev/null
    verify "$feed" src/oracle/ZenoTestnetFeed.sol:ZenoTestnetFeed </dev/null
  done
fi

# Credit stack (DeployCreditStack): the oracle is deployed directly, the rest are proxies whose
# implementation sits in the EIP-1967 slot. The oracle may sit in either compiler profile, so try both.
if jq -e .creditRegistry "$file" >/dev/null 2>&1; then
  proxy_impl() { cast implementation "$(addr "$1")" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL"; }
  # DeployCreditStack imports src/credit, so the script compiles the oracle in the credit-via-ir profile.
  verify_routed "$(addr creditOracle)" src/oracle/ZenoCompositeSanityOracle.sol:ZenoCompositeSanityOracle \
    out/ZenoCompositeSanityOracle.sol/ZenoCompositeSanityOracle.credit-via-ir.json
  verify "$(proxy_impl creditRegistry)" src/credit/ZenoCreditRegistry.sol:ZenoCreditRegistry
  verify "$(proxy_impl creditRouter)" src/credit/ZenoCreditRouter.sol:ZenoCreditRouter
  verify "$(proxy_impl creditVault)" src/credit/ZenoCreditVault.sol:ZenoCreditVault
  verify "$(proxy_impl creditPairTslaUsdg)" src/credit/ZenoCreditPair.sol:ZenoCreditPair
fi


# ZenoUpgradePlaceholder: the first implementation every core proxy points at, before DeployAll repoints it.
# The placeholder is recorded in packages/config (scripts/record-deployment.mjs), not in the deployment JSON.
record="$(echo "${NETWORK_NAME:-robinhood_testnet}" | sed -E "s/_(.)/\\U\\1/g")Implementations"
placeholder="$(grep -A40 "const $record" ../config/src/deployments.ts | grep -oE 'upgradePlaceholder: "0x[0-9a-fA-F]{40}"' | head -1 | grep -oE '0x[0-9a-fA-F]{40}' || true)"
if [[ -n "$placeholder" ]]; then
  verify "$placeholder" src/proxy/ZenoUpgradePlaceholder.sol:ZenoUpgradePlaceholder
fi

# The proxies themselves: every one is an OpenZeppelin ERC1967Proxy. Blockscout only shows a proxy as verified
# once its own source is verified (it reads the implementation for the ABI either way). Core proxies are built
# in the default profile, credit proxies in credit-via-ir.
proxy_src=lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy
proxy_ir=out/ERC1967Proxy.sol/ERC1967Proxy.credit-via-ir.json
while read -r key; do
  verify_routed "$(addr "$key")" "$proxy_src" "$proxy_ir" </dev/null
done < <(jq -r 'keys[]' "$impl_file")

echo "==> Done. Check output above for any '!!! FAILED' lines."
