DROP INDEX "parcel_watches_next_check_idx";--> statement-breakpoint
CREATE INDEX "watch_events_created_idx" ON "watch_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "parcel_watches_next_check_idx" ON "parcel_watches" USING btree ("enabled","next_check_at" ASC NULLS FIRST,"id");