CREATE TABLE "backup_status" (
	"kind" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_successful_at" timestamp with time zone,
	"snapshot_id" text,
	"last_error" text
);
