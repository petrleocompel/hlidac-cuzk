ALTER TABLE "parcel_watches" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD CONSTRAINT "watch_notes_length" CHECK (char_length("parcel_watches"."notes") <= 5000);--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD CONSTRAINT "watch_tags_count" CHECK (cardinality("parcel_watches"."tags") <= 20 and coalesce(array_ndims("parcel_watches"."tags"), 1) = 1 and array_position("parcel_watches"."tags", null) is null);