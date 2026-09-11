CREATE TABLE "cuzk_api_control" (
	"id" text PRIMARY KEY NOT NULL,
	"key_fingerprint" text NOT NULL,
	"next_request_at" timestamp with time zone,
	"blocked_until" timestamp with time zone,
	"blocked_reason" text,
	"account_json" jsonb,
	"account_day" date,
	"account_baseline" integer,
	"account_checked_at" timestamp with time zone,
	"account_attempt_at" timestamp with time zone,
	"account_error" text
);
--> statement-breakpoint
CREATE TABLE "cuzk_api_daily_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cuzk_api_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"endpoint" text NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "parcel_watches" ALTER COLUMN "poll_interval_minutes" SET DEFAULT 1440;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "manual_refresh_after" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "cuzk_api_requests_day_idx" ON "cuzk_api_requests" USING btree ("day");