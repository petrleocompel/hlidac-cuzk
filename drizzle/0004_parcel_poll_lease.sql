ALTER TABLE "parcel_watches" ADD COLUMN "poll_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "poll_locked_until" timestamp with time zone;