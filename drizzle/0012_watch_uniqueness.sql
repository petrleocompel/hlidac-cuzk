-- Workers must be stopped during migration. Preserve every event and its outbox
-- before consolidating duplicate subscriptions of one owner to one object.
CREATE TEMP TABLE watch_merge ON COMMIT DROP AS
SELECT id, first_value(id) OVER (
  PARTITION BY user_id, iskn_id
  ORDER BY (SELECT count(*) FROM watch_events e WHERE e.watch_id = w.id) DESC,
    created_at ASC, id ASC
) AS keep_id FROM parcel_watches w;
--> statement-breakpoint
UPDATE watch_events e SET watch_id = m.keep_id
FROM watch_merge m WHERE e.watch_id = m.id AND m.id <> m.keep_id;
--> statement-breakpoint
-- For overlapping trackers keep the most recently fetched state. Their complete
-- event histories have already been transferred; distinct trackers all survive.
WITH ranked AS (
  SELECT r.id, row_number() OVER (
    PARTITION BY m.keep_id, r.rizeni_id
    ORDER BY r.detail_fetched_at DESC NULLS LAST, r.updated_at DESC, r.id ASC
  ) AS rn
  FROM watch_rizeni r JOIN watch_merge m ON m.id = r.watch_id
)
DELETE FROM watch_rizeni WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
UPDATE watch_rizeni r SET watch_id = m.keep_id
FROM watch_merge m WHERE r.watch_id = m.id AND m.id <> m.keep_id;
--> statement-breakpoint
DELETE FROM parcel_watches WHERE id IN (SELECT id FROM watch_merge WHERE id <> keep_id);
--> statement-breakpoint
CREATE UNIQUE INDEX "parcel_watches_user_object_idx" ON "parcel_watches" USING btree ("user_id","iskn_id");
