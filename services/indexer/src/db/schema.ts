import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/// Materialized current-state view of ZenoMarketRegistry, kept in sync from `MarketAdded` /
/// `MarketUpdated` events (DEVELOPMENT_STEPS.md Phase 2 item 1) — `services/api` serves
/// `GET /markets` from this instead of an RPC call per request. `ZenoMarketRegistry` on-chain
/// remains the actual source of truth (PROJECT_BRIEF.md Section 18); this is a read cache.
/// uint256 fields (`maxLeverage`, `openInterestCap`) are stored as `text`, not `bigint` or
/// `numeric` — token amounts are 18-decimal fixed point and can exceed Postgres bigint's
/// ~9.2e18 ceiling (a $5M open interest cap already does); `text` avoids that overflow the
/// same way `numeric` would, written via `.toString()` in `src/index.ts`. Any future query
/// needing numeric range comparisons on these columns should switch them to `numeric`
/// first — comparing `text` values as `text` sorts/compares lexicographically, not numerically.
export const markets = pgTable("markets", {
  marketId: text("market_id").primaryKey(),
  underlyingToken: text("underlying_token").notNull(),
  oracleId: text("oracle_id").notNull(),
  optionsEnabled: boolean("options_enabled").notNull(),
  perpsEnabled: boolean("perps_enabled").notNull(),
  maxLeverage: text("max_leverage").notNull(),
  openInterestCap: text("open_interest_cap").notNull(),
  active: boolean("active").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/// Generic append-only log of every contract event this indexer watches (PROJECT_BRIEF.md
/// Section 31 / Section 35's event list) — one row per (tx_hash, log_index), the natural
/// idempotency key for a replay-safe indexer (DEVELOPMENT_STEPS.md "Backend services").
/// `args` stores the decoded event arguments as JSON (bigints pre-converted to strings by
/// the caller — see `src/serialize.ts` — since `jsonb` cannot hold a bigint directly).
/// `services/api` derives `/history/:wallet` from this by matching wallet-shaped args
/// fields; per-position live state is read from the chain, not reconstructed here.
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    contractName: text("contract_name").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("events_tx_hash_log_index_key").on(table.txHash, table.logIndex)],
);

/// Single-row table (id is always 1) tracking indexing progress, so a restart resumes from
/// `lastIndexedBlock + 1` instead of re-scanning from genesis or losing track entirely.
export const indexerState = pgTable("indexer_state", {
  id: integer("id").primaryKey(),
  lastIndexedBlock: bigint("last_indexed_block", { mode: "bigint" }).notNull(),
});

/// Index-price samples taken by the indexer on a fixed interval (`PRICE_SAMPLE_INTERVAL_MS`), so
/// the API can serve a price history and 24h change — the chain only exposes the current price.
/// `price` is the 18-decimal fixed-point index price as `text` (see `markets` for why not bigint).
/// Rows older than `PRICE_TICK_RETENTION_DAYS` are pruned; this is display history, not an audit
/// trail, and never feeds settlement or liquidation (those read the oracle onchain).
export const priceTicks = pgTable(
  "price_ticks",
  {
    id: serial("id").primaryKey(),
    marketId: text("market_id").notNull(),
    price: text("price").notNull(),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("price_ticks_market_sampled_idx").on(table.marketId, table.sampledAt)],
);

/// Per-wallet trading statistics for the leaderboard, derived from `events` (never written by hand)
/// by `src/traderStats.ts` on a fixed interval, then replaced wholesale for a window. One row per
/// (wallet, window); `all` is the only launch window, `24h` is a Phase 18 value of the same column.
/// Every amount is `text` for the reason `markets` documents (settlement-token base units and
/// 18-decimal values overflow bigint). `text` sorts lexicographically, so `services/api` casts to
/// `numeric` before ordering: never `order by` one of these as text.
///   realised_pnl      price PNL realised + funding - fees, signed.
///   unrealised_pnl    PNL of open perp positions at the live mark, signed.
///   capital_deployed  margin posted on perps + premium paid on options; the ROI denominator.
///   roi_bps           (realised + unrealised) * 10000 / capital_deployed, signed, "0" with no capital.
///   volume            perp notional traded + option premium paid.
/// `win_rate_bps` is null until the wallet has closed a position.
export const traderStats = pgTable(
  "trader_stats",
  {
    wallet: text("wallet").notNull(),
    window: text("window").notNull(),
    realisedPnl: text("realised_pnl").notNull(),
    unrealisedPnl: text("unrealised_pnl").notNull(),
    capitalDeployed: text("capital_deployed").notNull(),
    roiBps: text("roi_bps").notNull(),
    volume: text("volume").notNull(),
    tradeCount: integer("trade_count").notNull(),
    closedCount: integer("closed_count").notNull(),
    winRateBps: integer("win_rate_bps"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.wallet, table.window] })],
);

/// A wallet's choice to hide from the leaderboard and its PNL card. Written by `services/api` after it
/// verifies an EIP-191 signature from the wallet; absent means visible. `issued_at` is the signed unix
/// time of the last accepted change, so an old signature cannot be replayed to undo a newer choice.
export const leaderboardVisibility = pgTable("leaderboard_visibility", {
  wallet: text("wallet").primaryKey(),
  hidden: boolean("hidden").notNull(),
  issuedAt: bigint("issued_at", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/// A follower's standing instruction to mirror one leader's perp trades into a copy subaccount (copy trading,
/// `docs/COPY_TRADING.md`). Written by `services/api` after it verifies the follower's EIP-191 signature over the
/// caps and checks on chain that the follower owns the subaccount. `services/keeper`'s copy executor reads the
/// active rows. The caps (all in settlement-token base units, leverage in whole multiples) are the follower's own
/// limits; `markets` is a list of symbols, or null for every market. Stopping a follow sets `active` false at once;
/// the follower should also revoke the executor as a delegate on chain, which the executor re-checks every pass.
export const copyFollows = pgTable(
  "copy_follows",
  {
    id: serial("id").primaryKey(),
    follower: text("follower").notNull(),
    leader: text("leader").notNull(),
    subaccount: text("subaccount").notNull(),
    maxTradeSize: text("max_trade_size").notNull(),
    maxExposure: text("max_exposure").notNull(),
    maxLeverage: integer("max_leverage").notNull(),
    markets: jsonb("markets"),
    active: boolean("active").notNull().default(true),
    /// `issued_at` of the last accepted signed change, so an old signature cannot undo a newer one.
    issuedAt: bigint("issued_at", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("copy_follows_follower_leader_key").on(table.follower, table.leader)],
);

/// What the executor did with one leader position for one follow. `existing`: the leader already held it when the
/// follow began, so it is never copied. `open` / `closed`: mirrored and later unwound. `skipped`: deliberately not
/// mirrored, with the reason in plain words (a cap, margin, a paused market); nothing was opened, not even a part.
export const copyExecutions = pgTable(
  "copy_executions",
  {
    id: serial("id").primaryKey(),
    followId: integer("follow_id").notNull(),
    leaderPositionId: text("leader_position_id").notNull(),
    followerPositionId: text("follower_position_id"),
    status: text("status").notNull(),
    reason: text("reason"),
    market: text("market").notNull(),
    isLong: boolean("is_long").notNull(),
    leaderSize: text("leader_size").notNull(),
    followerSize: text("follower_size"),
    openTx: text("open_tx"),
    closeTx: text("close_tx"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("copy_executions_follow_leader_position_key").on(table.followId, table.leaderPositionId)],
);

/// A wallet's price alert (`packages/sdk/src/alerts.ts` defines the kinds and the maths). `services/api` writes it
/// after verifying the wallet's EIP-191 signature and reads it for `GET /v1/alerts/:wallet`; `services/indexer`'s
/// `evaluateAlerts` is the only other writer, and only ever moves `active` to `triggered`. `target` is a price in
/// 18-decimal fixed point for `price_above` / `price_below` and whole basis points for `pct_up` / `pct_down`;
/// `base_price` is the index price at creation, which a percent is measured against. Amounts are `text` for the reason
/// `markets` documents. `(wallet, issued_at)` is unique, so a captured signed request replayed inside its time window
/// cannot create a second alert.
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    symbol: text("symbol").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    basePrice: text("base_price").notNull(),
    /// active | triggered | cancelled
    status: text("status").notNull().default("active"),
    triggerPrice: text("trigger_price"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    issuedAt: bigint("issued_at", { mode: "bigint" }).notNull(),
  },
  (table) => [unique("price_alerts_wallet_issued_at_key").on(table.wallet, table.issuedAt), index("price_alerts_status_symbol_idx").on(table.status, table.symbol)],
);

/// A browser a wallet chose to receive Web Push on. Written by `services/api` (signed subscribe); read by
/// `services/indexer` when an alert fires; deleted by the indexer when the push service answers 404 or 410. The
/// endpoint is the browser's own address at its push service, so it is the key.
export const pushSubscriptions = pgTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  wallet: text("wallet").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/// What a fired alert says, kept for the bell in the header. Written only by `services/indexer`, in the same
/// transaction that claims the alert, and read by `services/api` (`GET /v1/notifications/:wallet`). `alert_id` is
/// unique: an alert can produce one notification, ever. Rows older than the retention window are pruned.
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    alertId: integer("alert_id").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    symbol: text("symbol").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_wallet_id_idx").on(table.wallet, table.id)],
);
