CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"alert_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_alert_id_unique" UNIQUE("alert_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"base_price" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"trigger_price" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_at" timestamp with time zone,
	"issued_at" bigint NOT NULL,
	CONSTRAINT "price_alerts_wallet_issued_at_key" UNIQUE("wallet","issued_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_wallet_id_idx" ON "notifications" USING btree ("wallet","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_alerts_status_symbol_idx" ON "price_alerts" USING btree ("status","symbol");