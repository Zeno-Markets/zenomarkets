/// Shared shapes mirroring the on-chain structs in `packages/contracts/src/interfaces/DataTypes.sol`
/// and the position-manager contracts. Contracts, API, indexer, SDK, and frontend all import
/// these instead of redefining them locally (DEVELOPMENT_STEPS.md "Monorepo tooling").

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/// Mirrors `OptionType` in DataTypes.sol — numeric values must stay in sync with the enum order.
export enum OptionType {
  CALL = 0,
  PUT = 1,
}

/// Mirrors `MarketConfig` in DataTypes.sol.
export interface MarketConfig {
  marketId: Hex;
  underlyingToken: Address;
  oracleId: Hex;
  optionsEnabled: boolean;
  perpsEnabled: boolean;
  maxLeverage: bigint;
  openInterestCap: bigint;
  active: boolean;
}

/// Mirrors `ZenoOptionPositionManager.PositionStatus`.
export enum OptionPositionStatus {
  OPEN = 0,
  CLOSED = 1,
  SETTLED = 2,
}

/// Mirrors `ZenoOptionPositionManager.OptionPosition`.
export interface OptionPosition {
  positionId: bigint;
  marketId: Hex;
  optionType: OptionType;
  strike: bigint;
  expiry: bigint;
  contracts: bigint;
  entryPremium: bigint;
  collateral: bigint;
  realizedPnl: bigint;
  status: OptionPositionStatus;
  owner: Address;
}

/// Mirrors `ZenoPerpPositionManager.PerpPosition`.
export interface PerpPosition {
  positionId: bigint;
  marketId: Hex;
  isLong: boolean;
  entryPrice: bigint;
  size: bigint;
  collateral: bigint;
  leverage: bigint;
  realizedPnl: bigint;
  fundingAccrued: bigint;
  lastFundingIndex: bigint;
  open: boolean;
  owner: Address;
}

/// The group a market is listed under in the UI. Data, not UI structure: a market's group lives in
/// `packages/contracts/deployments/<network>.markets.json` and is read through `@zeno/config`, so a
/// regrouping is a data change and never an edit to app code.
///
/// The order here is the order of the `/markets` tabs. `china` is shown as "China & Asia": it holds the
/// two China names `REFERENCE.md` Section 2 Finding 2 found a Chainlink feed for (BABA, TSM) plus EWY.
/// `commodities` and `etf` regroup listings that already trade (UI rework Session 5); a group is a
/// display grouping only and never changes a market's tier, feed or leverage.
export const MARKET_GROUPS = ["us-equities", "china", "commodities", "etf", "crypto"] as const;

export type MarketGroup = (typeof MARKET_GROUPS)[number];

/// How far a listing goes, from a full leveraged market down to metadata only. The three-tier model in
/// `REFERENCE.md` Section 2: listing an asset is not the same as opening a leveraged market on it.
///
/// - `tradeable` — full ticket, leverage, positions, liquidation price. Priced by a Chainlink feed, so
///   **a tradeable listing must carry a feed address.**
/// - `quoted` — price, chart, 24h change, watchlist, searchable. No leverage and no trade button.
///   Priced off chain (DexScreener, or the Robinhood reference price) for display only.
/// - `listed` — name, logo, description, socials, and an honest "no price feed yet" state.
///
/// **A quoted or listed entry must have no feed address.** That is the boundary that stops a display
/// price reaching settlement, and `@zeno/config`'s `marketsForTier` enforces it in both directions
/// rather than leaving it to convention.
export const LISTING_TIERS = ["tradeable", "quoted", "listed"] as const;

export type ListingTier = (typeof LISTING_TIERS)[number];

/// Tiers that are display only: their price never reaches `ZenoPriceValidator` or settlement.
export const DISPLAY_ONLY_TIERS = ["quoted", "listed"] as const satisfies ReadonlyArray<ListingTier>;

// ---------------------------------------------------------------------------
// Credit stack types (Phase 9)
// ---------------------------------------------------------------------------

/// Mirrors `ZenoCreditRegistry.RiskTier`.
export enum CreditRiskTier {
  TierA = 0,
  TierB = 1,
  TierC = 2,
  Experimental = 3,
}

/// Mirrors `ZenoCreditRegistry.MarketStatus`.
export enum CreditMarketStatus {
  NORMAL = 0,
  REDUCE_ONLY = 1,
  PAUSED = 2,
}

/// Mirrors the return type of `ZenoCreditPair.getPosition(address)`.
export interface CreditPosition {
  collateralAmount: bigint;
  debtAmount: bigint;
  /// USD value of the collateral, scaled 1e18.
  collateralValueUsd: bigint;
  /// Health factor in basis points: 10000 = 1.00x (at liquidation threshold). Higher is safer.
  /// A position with healthFactorBps < 10000 is liquidatable. No debt returns 9990000 (999.00x).
  healthFactorBps: bigint;
}

/// Mirrors `ZenoCreditRegistry.MarketConfig`.
export interface CreditMarketConfig {
  marketId: Hex;
  slug: string;
  collateralToken: Address;
  debtToken: Address;
  pairAddress: Address;
  oracle: Address;
  riskTier: CreditRiskTier;
  status: CreditMarketStatus;
  /// Maximum loan-to-value in basis points (e.g. 6000 = 60%).
  maxLtvBps: bigint;
  /// Liquidation threshold in basis points (e.g. 7000 = 70%).
  liquidationLtvBps: bigint;
  /// Maximum leverage in basis points (e.g. 25000 = 2.5x, basis 10000 = 1x).
  maxLeverageBps: bigint;
  /// Total collateral deposit cap in collateral token base units.
  supplyCap: bigint;
  /// Total borrow cap in debt token base units.
  borrowCap: bigint;
}

export function isMarketGroup(value: unknown): value is MarketGroup {
  return typeof value === "string" && (MARKET_GROUPS as readonly string[]).includes(value);
}

export function isListingTier(value: unknown): value is ListingTier {
  return typeof value === "string" && (LISTING_TIERS as readonly string[]).includes(value);
}

/// True when a listing of this tier settles on chain and therefore needs a price feed. The one place
/// that decides it, so the rule cannot drift between config, the API and the web app.
export function tierNeedsFeed(tier: ListingTier): boolean {
  return tier === "tradeable";
}
