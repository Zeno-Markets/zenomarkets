CREATE TABLE IF NOT EXISTS "leaderboard_visibility" (
	"wallet" text PRIMARY KEY NOT NULL,
	"hidden" boolean NOT NULL,
	"issued_at" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trader_stats" (
	"wallet" text NOT NULL,
	"window" text NOT NULL,
	"realised_pnl" text NOT NULL,
	"unrealised_pnl" text NOT NULL,
	"capital_deployed" text NOT NULL,
	"roi_bps" text NOT NULL,
	"volume" text NOT NULL,
	"trade_count" integer NOT NULL,
	"closed_count" integer NOT NULL,
	"win_rate_bps" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_stats_wallet_window_pk" PRIMARY KEY("wallet","window")
);
