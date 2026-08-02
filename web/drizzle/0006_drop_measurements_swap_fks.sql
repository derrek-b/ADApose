ALTER TABLE "current_readings" DROP CONSTRAINT "current_readings_fee_apr_7d_measurement_id_measurements_id_fk";
--> statement-breakpoint
ALTER TABLE "current_readings" DROP CONSTRAINT "current_readings_fee_apr_30d_measurement_id_measurements_id_fk";
--> statement-breakpoint
DROP TABLE "measurements";
--> statement-breakpoint
ALTER TABLE "current_readings" DROP COLUMN "fee_apr_7d_measurement_id";
--> statement-breakpoint
ALTER TABLE "current_readings" DROP COLUMN "fee_apr_30d_measurement_id";
--> statement-breakpoint
ALTER TABLE "current_readings" ADD COLUMN "fee_apr_7d_from_snapshot_id" integer;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD COLUMN "fee_apr_7d_to_snapshot_id" integer;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD COLUMN "fee_apr_30d_from_snapshot_id" integer;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD COLUMN "fee_apr_30d_to_snapshot_id" integer;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_7d_from_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("fee_apr_7d_from_snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_7d_to_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("fee_apr_7d_to_snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_30d_from_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("fee_apr_30d_from_snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "current_readings" ADD CONSTRAINT "current_readings_fee_apr_30d_to_snapshot_id_pool_snapshots_id_fk" FOREIGN KEY ("fee_apr_30d_to_snapshot_id") REFERENCES "public"."pool_snapshots"("id") ON DELETE no action ON UPDATE no action;
