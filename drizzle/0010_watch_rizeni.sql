CREATE TABLE "watch_rizeni" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watch_id" uuid NOT NULL,
	"rizeni_id" text NOT NULL,
	"source" text DEFAULT 'plomba' NOT NULL,
	"typ_rizeni" text,
	"poradove_cislo" integer,
	"rok" integer,
	"kod_pracoviste" integer,
	"is_plomba" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detached_at" timestamp with time zone,
	"follow_until" timestamp with time zone,
	"follow_ended_at" timestamp with time zone,
	"follow_ended_reason" text,
	"detail_json" jsonb,
	"detail_fetched_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_rizeni" ADD CONSTRAINT "watch_rizeni_watch_id_parcel_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."parcel_watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_rizeni_watch_rizeni_idx" ON "watch_rizeni" USING btree ("watch_id","rizeni_id");--> statement-breakpoint
CREATE INDEX "watch_rizeni_follow_idx" ON "watch_rizeni" USING btree ("watch_id","follow_ended_at");