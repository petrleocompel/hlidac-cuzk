ALTER TABLE "notification_policy" ADD COLUMN "ntfy_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policy" ADD COLUMN "email_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_policy" ADD COLUMN "ntfy_allowed_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "notify_kinds" text[];--> statement-breakpoint
ALTER TABLE "parcel_watches" ADD COLUMN "notify_channels" text[];--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "ntfy_url" text;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "ntfy_token" text;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "email_to" text;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "timezone" text DEFAULT 'Europe/Prague' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "quiet_from_minutes" integer;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "quiet_to_minutes" integer;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "digest_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "digest_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "digest_weekday" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_settings" ADD COLUMN "urgent_kinds" text[] DEFAULT '{new_rizeni,lv_change}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE notification_deliveries ADD COLUMN digest boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE notification_deliveries ADD COLUMN urgent boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE user_notification_settings ADD COLUMN use_instance_gotify boolean NOT NULL DEFAULT false;
