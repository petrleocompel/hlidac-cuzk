-- Duplicate subscriptions of the same user to the same object are a mistake,
-- but their history must not be thrown away silently: keep the row with the most
-- recorded events (then the oldest one) and drop the rest before the unique index.
WITH ranked AS (
	SELECT w.id,
		row_number() OVER (
			PARTITION BY w.user_id, w.iskn_id
			ORDER BY (SELECT count(*) FROM watch_events e WHERE e.watch_id = w.id) DESC,
				w.created_at ASC,
				w.id ASC
		) AS rn
	FROM parcel_watches w
)
DELETE FROM parcel_watches WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "parcel_watches_user_object_idx" ON "parcel_watches" USING btree ("user_id","iskn_id");