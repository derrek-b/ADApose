CREATE TABLE "measurements" (
	"id" serial PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"track_asset" text NOT NULL,
	"pool_label" text,
	"from_ts" timestamp with time zone NOT NULL,
	"to_ts" timestamp with time zone NOT NULL,
	"days" numeric(10, 3) NOT NULL,
	"sqrtk_per_lp_from" numeric(48, 18) NOT NULL,
	"sqrtk_per_lp_to" numeric(48, 18) NOT NULL,
	"growth_pct" numeric(20, 6) NOT NULL,
	"fee_apr_pct" numeric(20, 4) NOT NULL,
	"reserve_a_to" numeric(20, 0) NOT NULL,
	"reserve_b_to" numeric(20, 0) NOT NULL,
	"lp_supply_to" numeric(20, 0) NOT NULL,
	"venue_verified" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
