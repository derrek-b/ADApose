CREATE TABLE "pool_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"track_asset" text NOT NULL,
	"pool_label" text,
	"ts" timestamp with time zone NOT NULL,
	"sqrtk_per_lp" numeric(48, 18) NOT NULL,
	"reserve_a" numeric(20, 0) NOT NULL,
	"reserve_b" numeric(20, 0) NOT NULL,
	"lp_supply" numeric(20, 0) NOT NULL,
	"venue_verified" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_snapshots_unique_reading" UNIQUE("venue","track_asset","ts")
);
