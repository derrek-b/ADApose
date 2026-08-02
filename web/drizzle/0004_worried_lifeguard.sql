ALTER TABLE "current_readings" ADD COLUMN "last_measured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "current_readings" ADD COLUMN "last_sqrtk_per_lp" numeric(48, 18);