import { addressesForChain, chains, protocolTokens, resolveChainId, ROBINHOOD_TESTNET_CHAIN_ID, type ChainId, type ContractAddresses } from "@zeno/config";
import type { Address } from "@zeno/types";
import { pickProtocolToken } from "./protocolToken";
import { storedChainId } from "./network";

/// Every value the terminal needs from the environment (PROJECT_BRIEF.md Section 4). Next only
/// inlines `process.env.NEXT_PUBLIC_*` when written out literally, so each name appears in full
/// here rather than being looked up dynamically.
const raw = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  rpcProxyUrl: process.env.NEXT_PUBLIC_RPC_PROXY_URL,
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  rpcUrlTestnet: process.env.NEXT_PUBLIC_RPC_URL_TESTNET,
  rpcUrlMainnet: process.env.NEXT_PUBLIC_RPC_URL_MAINNET,
  rpcProxyUrlTestnet: process.env.NEXT_PUBLIC_RPC_PROXY_URL_TESTNET,
  rpcProxyUrlMainnet: process.env.NEXT_PUBLIC_RPC_PROXY_URL_MAINNET,
  explorerUrlTestnet: process.env.NEXT_PUBLIC_EXPLORER_URL_TESTNET,
  explorerUrlMainnet: process.env.NEXT_PUBLIC_EXPLORER_URL_MAINNET,
  apiUrlTestnet: process.env.NEXT_PUBLIC_API_URL_TESTNET,
  apiUrlMainnet: process.env.NEXT_PUBLIC_API_URL_MAINNET,
  marketRegistry: process.env.NEXT_PUBLIC_MARKET_REGISTRY,
  vault: process.env.NEXT_PUBLIC_ZENO_VAULT,
  optionsEngine: process.env.NEXT_PUBLIC_OPTIONS_ENGINE,
  perpsEngine: process.env.NEXT_PUBLIC_PERPS_ENGINE,
  oracleRouter: process.env.NEXT_PUBLIC_ORACLE_ROUTER,
  riskManager: process.env.NEXT_PUBLIC_RISK_MANAGER,
  feeManager: process.env.NEXT_PUBLIC_FEE_MANAGER,
  settlementToken: process.env.NEXT_PUBLIC_COLLATERAL_TOKEN,
  collateralManager: process.env.NEXT_PUBLIC_COLLATERAL_MANAGER,
  optionMarket: process.env.NEXT_PUBLIC_OPTION_MARKET,
  optionPositionManager: process.env.NEXT_PUBLIC_OPTION_POSITION_MANAGER,
  perpPositionManager: process.env.NEXT_PUBLIC_PERP_POSITION_MANAGER,
  perpOrderManager: process.env.NEXT_PUBLIC_PERP_ORDER_MANAGER,
  liquidationEngine: process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE,
  fundingManager: process.env.NEXT_PUBLIC_FUNDING_MANAGER,
  priceValidator: process.env.NEXT_PUBLIC_PRICE_VALIDATOR,
  buybackModule: process.env.NEXT_PUBLIC_BUYBACK_MODULE,
  protocolTokenAddress: process.env.NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS,
  protocolTokenSymbol: process.env.NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL,
  protocolTokenLive: process.env.NEXT_PUBLIC_PROTOCOL_TOKEN_LIVE,
  optionStrikeStepBps: process.env.NEXT_PUBLIC_OPTION_STRIKE_STEP_BPS,
  optionStrikeRows: process.env.NEXT_PUBLIC_OPTION_STRIKE_ROWS,
  optionExpiryDays: process.env.NEXT_PUBLIC_OPTION_EXPIRY_DAYS,
  optionExpiryHourUtc: process.env.NEXT_PUBLIC_OPTION_EXPIRY_HOUR_UTC,
  creditPair: process.env.NEXT_PUBLIC_CREDIT_PAIR,
  creditSymbol: process.env.NEXT_PUBLIC_CREDIT_SYMBOL,
  creditExampleMaxLtvBps: process.env.NEXT_PUBLIC_CREDIT_EXAMPLE_MAX_LTV_BPS,
  creditExampleLiquidationLtvBps: process.env.NEXT_PUBLIC_CREDIT_EXAMPLE_LIQ_LTV_BPS,
  featureCopyTrading: process.env.NEXT_PUBLIC_FEATURE_COPY_TRADING,
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
};

/// A whole number from the environment, or `fallback` when it is unset, not a number or out of range.
function wholeNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/// Comma-separated whole numbers ("7,14,30"), keeping only valid entries; `fallback` if none remain.
function wholeNumberList(value: string | undefined, fallback: number[], min: number, max: number): number[] {
  const parsed = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= min && n <= max);
  return parsed.length > 0 ? [...new Set(parsed)].sort((a, b) => a - b) : fallback;
}

/// The network the build was made for, and the one the person picked (kept in this browser). The
/// single-network variables (`NEXT_PUBLIC_RPC_URL`, ...) and the contract address overrides describe the
/// build's own network only; the `_TESTNET` and `_MAINNET` variables describe each network.
const buildChainId: ChainId = resolveChainId(raw.chainId);
const chainId: ChainId = storedChainId() ?? buildChainId;
const isBuildChain = chainId === buildChainId;
const testnet = chainId === ROBINHOOD_TESTNET_CHAIN_ID;
/// A per-network value wins; the single-network one applies only on the build's own network.
const forThisNetwork = (testnetValue: string | undefined, mainnetValue: string | undefined, single: string | undefined) =>
  (testnet ? testnetValue : mainnetValue) || (isBuildChain ? single : undefined);
const endpoints = {
  rpcUrl: forThisNetwork(raw.rpcUrlTestnet, raw.rpcUrlMainnet, raw.rpcUrl),
  rpcProxyUrl: forThisNetwork(raw.rpcProxyUrlTestnet, raw.rpcProxyUrlMainnet, raw.rpcProxyUrl),
  explorerUrl: forThisNetwork(raw.explorerUrlTestnet, raw.explorerUrlMainnet, raw.explorerUrl),
  apiUrl: forThisNetwork(raw.apiUrlTestnet, raw.apiUrlMainnet, raw.apiUrl),
};

/// The recorded deployment for `chainId`, with any contract address set in the environment
/// replacing the recorded one for that contract only.
function resolveAddresses(): ContractAddresses {
  const overrides: Partial<Record<keyof ContractAddresses, string | undefined>> = {
    marketRegistry: raw.marketRegistry,
    vault: raw.vault,
    optionsEngine: raw.optionsEngine,
    perpsEngine: raw.perpsEngine,
    oracleRouter: raw.oracleRouter,
    riskManager: raw.riskManager,
    feeManager: raw.feeManager,
    settlementToken: raw.settlementToken,
    collateralManager: raw.collateralManager,
    optionMarket: raw.optionMarket,
    optionPositionManager: raw.optionPositionManager,
    perpPositionManager: raw.perpPositionManager,
    perpOrderManager: raw.perpOrderManager,
    liquidationEngine: raw.liquidationEngine,
    fundingManager: raw.fundingManager,
    priceValidator: raw.priceValidator,
    buybackModule: raw.buybackModule,
  };
  const resolved = { ...addressesForChain(chainId) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && isBuildChain) resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}

/// The protocol token shown as "CA": none until `NEXT_PUBLIC_PROTOCOL_TOKEN_LIVE=true` (the token has not
/// launched), then the environment's address or the chain's recorded token. See `lib/protocolToken.ts`.
function resolveProtocolToken(): { address: Address; symbol: string } | undefined {
  const recorded = protocolTokens[chainId];
  const token = pickProtocolToken({
    live: raw.protocolTokenLive,
    address: raw.protocolTokenAddress,
    recordedAddress: recorded?.address,
    symbol: raw.protocolTokenSymbol,
    recordedSymbol: recorded?.symbol,
  });
  return token ? { address: token.address as Address, symbol: token.symbol } : undefined;
}

function validAddress(value: string | undefined): Address | undefined {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value.trim()) ? (value.trim() as Address) : undefined;
}

export const env = {
  chainId,
  /// No default RPC is baked in: Robinhood's own default had an expired TLS certificate
  /// (packages/contracts CHANGELOG). When unset, a reserved `.invalid` host stands in so the app
  /// still builds and renders, and every read fails visibly instead of silently using another RPC.
  rpcUrl: endpoints.rpcUrl || "http://rpc-not-configured.invalid",
  rpcConfigured: Boolean(endpoints.rpcUrl || endpoints.rpcProxyUrl),
  /// Where the app's own reads go. `services/api` serves `/v1/rpc`, a caching proxy, so many
  /// visitors share one upstream call instead of each spending the provider's quota. Unset reads
  /// straight from `rpcUrl`. The wallet still gets `rpcUrl` (see `chain` in wagmi.ts), because it
  /// broadcasts transactions itself and the proxy refuses writes.
  readRpcUrl: endpoints.rpcProxyUrl || endpoints.rpcUrl || "http://rpc-not-configured.invalid",
  /// The environment wins; otherwise the explorer recorded for the chain in `@zeno/config` (mainnet has one,
  /// testnet has none recorded), so contract links work without extra setup.
  explorerUrl: endpoints.explorerUrl || chains[chainId].blockExplorers?.default.url,
  apiUrl: endpoints.apiUrl ? endpoints.apiUrl.replace(/\/+$/, "") : undefined,
  addresses: resolveAddresses(),
  /// Absent until a token exists for this chain.
  protocolToken: resolveProtocolToken(),
  /// Limit orders need a deployment that includes `ZenoPerpOrderManager`; the terminal hides them without one.
  limitOrders: Boolean(resolveAddresses().perpOrderManager),
  /// Cross margin needs a deployment that includes `ZenoCrossMarginManager`; the ticket hides it without one.
  crossMargin: Boolean(resolveAddresses().crossMargin),
  /// The trader profile and copy flow routes (`/traders/...`). Off unless set to `true`; while on before
  /// Phase 14 they are labelled shells with no data. The leaderboard's Copy action stays disabled either way.
  copyTrading: raw.featureCopyTrading === "true",
  /// The public half of the Web Push key (the private half lives on the indexer). Without it the page offers in-app alerts only.
  vapidPublicKey: raw.vapidPublicKey?.trim() || undefined,
  /// The lending pair (Phase 9). The environment wins; otherwise the deployment record's `creditPairTslaUsdg`,
  /// which the contracts lane adds to `@zeno/config` once the credit stack is broadcast. Read through a loose
  /// record so this builds before and after that key exists. `undefined` until then: the page says so.
  creditSymbol: (raw.creditSymbol || "TSLA").trim().toUpperCase(),
  /// Worked-example thresholds for the health calculator while the pair is not deployed on this network, so
  /// the page can still teach what a health factor is. They are labelled as examples on screen and replaced by
  /// the pair's own the moment it exists. They follow the launch parameters in docs/evidence/phase-9.md.
  creditExample: {
    maxLtvBps: wholeNumber(raw.creditExampleMaxLtvBps, 6_000, 1, 9_999),
    liquidationLtvBps: wholeNumber(raw.creditExampleLiquidationLtvBps, 7_000, 1, 9_999),
  },
  creditPair: (isBuildChain ? validAddress(raw.creditPair) : undefined) ?? validAddress((resolveAddresses() as unknown as Record<string, string | undefined>).creditPairTslaUsdg),
  /// Option chain layout. The contract lists no strikes (a series is created on first use), so the
  /// terminal proposes a ladder around spot and a few upcoming expiries; these set its shape.
  options: {
    strikeStepBps: wholeNumber(raw.optionStrikeStepBps, 500, 1, 5_000),
    strikeRows: wholeNumber(raw.optionStrikeRows, 5, 1, 20),
    expiryDays: wholeNumberList(raw.optionExpiryDays, [7, 14, 30], 1, 365),
    expiryHourUtc: wholeNumber(raw.optionExpiryHourUtc, 20, 0, 23),
  },
} as const;
