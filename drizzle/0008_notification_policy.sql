CREATE TABLE "notification_policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"gotify_enabled" boolean DEFAULT true NOT NULL,
	"slack_enabled" boolean DEFAULT true NOT NULL,
	"discord_enabled" boolean DEFAULT true NOT NULL,
	"gotify_allowed_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
