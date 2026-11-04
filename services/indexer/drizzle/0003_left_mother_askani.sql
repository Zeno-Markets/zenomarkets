CREATE TABLE IF NOT EXISTS "copy_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"follow_id" integer NOT NULL,
	"leader_position_id" text NOT NULL,
	"follower_position_id" text,
	"status" text NOT NULL,
	"reason" text,
	"market" text NOT NULL,
	"is_long" boolean NOT NULL,
	"leader_size" text NOT NULL,
	"follower_size" text,
	"open_tx" text,
	"close_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_executions_follow_leader_position_key" UNIQUE("follow_id","leader_position_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copy_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower" text NOT NULL,
	"leader" text NOT NULL,
	"subaccount" text NOT NULL,
	"max_trade_size" text NOT NULL,
	"max_exposure" text NOT NULL,
	"max_leverage" integer NOT NULL,
	"markets" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"issued_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_follows_follower_leader_key" UNIQUE("follower","leader")
);
