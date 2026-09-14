CREATE UNIQUE INDEX "parcel_watches_owner_id_idx" ON "parcel_watches" USING btree ("user_id","id");
--> statement-breakpoint
CREATE TABLE "watch_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_watch_id" uuid NOT NULL,
	"to_watch_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_links_distinct" CHECK ("watch_links"."from_watch_id" <> "watch_links"."to_watch_id"),
	CONSTRAINT "watch_links_note_length" CHECK (char_length("watch_links"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "watch_links" ADD CONSTRAINT "watch_links_from_owner_fk" FOREIGN KEY ("user_id","from_watch_id") REFERENCES "public"."parcel_watches"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_links" ADD CONSTRAINT "watch_links_to_owner_fk" FOREIGN KEY ("user_id","to_watch_id") REFERENCES "public"."parcel_watches"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_links_edge_idx" ON "watch_links" USING btree ("from_watch_id","to_watch_id");--> statement-breakpoint
CREATE INDEX "watch_links_target_idx" ON "watch_links" USING btree ("to_watch_id");--> statement-breakpoint
