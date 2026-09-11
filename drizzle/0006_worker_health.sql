CREATE TABLE "worker_health" (
	"id" text PRIMARY KEY NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_outage_at" timestamp with time zone,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"run_token" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"last_error" text,
	"summary" jsonb
);
--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "last_successful_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "parcel_watches_next_check_idx" ON "parcel_watches" USING btree ("enabled","next_check_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.hlidac_snapshot_time(value text) RETURNS timestamptz
LANGUAGE plpgsql AS $$
BEGIN
  RETURN value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint
UPDATE parcel_watches SET
  last_attempt_at = last_checked_at,
  last_successful_check_at = CASE WHEN last_snapshot_json IS NOT NULL THEN
    coalesce(pg_temp.hlidac_snapshot_time(last_snapshot_json->>'fetchedAt'),
      CASE WHEN last_error IS NULL THEN last_checked_at END)
    END,
  next_check_at = coalesce(last_checked_at + poll_interval_minutes * interval '1 minute', created_at);
