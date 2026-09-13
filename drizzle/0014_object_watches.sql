DROP INDEX "parcel_watches_user_object_idx";--> statement-breakpoint
ALTER TABLE "parcel_watches" ALTER COLUMN "ku_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ALTER COLUMN "ku_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ALTER COLUMN "parcel_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "object_type" text DEFAULT 'parcel' NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "object_summary" text;--> statement-breakpoint
CREATE UNIQUE INDEX "parcel_watches_user_object_idx" ON "parcel_watches" USING btree ("user_id","object_type","iskn_id");