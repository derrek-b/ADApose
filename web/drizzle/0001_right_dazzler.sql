CREATE TABLE "current_readings" (
	"venue" text NOT NULL,
	"track_asset" text NOT NULL,
	"pool_label" text,
	"tvl_ada" numeric(24, 6),
	"volume_24h_ada" numeric(24, 6),
	"volume_7d_ada" numeric(24, 6),
	"volume_30d_ada" numeric(24, 6),
	"fee_apr_7d_pct" numeric(20, 4),
	"fee_apr_7d_actual_days" numeric(10, 3),
	"fee_apr_7d_measurement_id" integer,
	"fee_apr_30d_pct" numeric(20, 4),
	"fee_apr_30d_actual_days" numeric(10, 3),
	"fee_apr_30d_measurement_id" integer,
	"venue_verified" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "current_readings_venue_track_asset_pk" PRIMARY KEY("venue","track_asset")
);
--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_7d_measurement_id_measurements_id_fk" FOREIGN KEY ("fee_apr_7d_measurement_id") REFERENCES "public"."measurements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_30d_measurement_id_measurements_id_fk" FOREIGN KEY ("fee_apr_30d_measurement_id") REFERENCES "public"."measurements"("id") ON DELETE no action ON UPDATE no action;