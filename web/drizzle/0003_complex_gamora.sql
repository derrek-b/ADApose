CREATE TABLE "pools" (
	"venue" text NOT NULL,
	"track_asset" text NOT NULL,
	"lp_asset" text NOT NULL,
	"label" text NOT NULL,
	"script_hash" text NOT NULL,
	"nft" text NOT NULL,
	"asset_a" text NOT NULL,
	"asset_b" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pools_venue_track_asset_pk" PRIMARY KEY("venue","track_asset")
);
