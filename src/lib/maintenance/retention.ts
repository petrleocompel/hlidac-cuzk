import { sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  retentionSchema,
  RETENTION_BATCH_SIZE,
  apiRetentionBoundary,
} from './policy'

/** At most 1000 rows per category per run; no network, no daily quota deletion. */
export async function runRetention(
  options: { apply?: boolean; policy?: unknown; now?: Date } = {},
) {
  const policy = retentionSchema.parse(options.policy ?? process.env)
  const now = options.now ?? new Date()
  const cutoff = (days: number) =>
    new Date(now.getTime() - days * 86400000).toISOString()
  const summary = {
    applied: options.apply === true,
    locked: false,
    snapshots: 0,
    events: 0,
    errors: 0,
    apiRequests: 0,
  }
  if (!Object.values(policy).some(Boolean)) return summary
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '10s'`)
    await tx.execute(sql`set local lock_timeout = '2s'`)
    const [lock] = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtext('hlidac:retention')) as acquired`,
    )
    if (!lock.acquired) return { ...summary, locked: true }
    // Failed/deferred/processing/pending delivery states all protect source history.
    const delivered = sql`not exists (select 1 from notification_deliveries d where d.event_id = e.id and d.status <> 'sent')`
    const age = (days: number) =>
      sql`e.created_at < ${cutoff(days)}::timestamptz`
    const categories = [
      {
        key: 'snapshots' as const,
        days: policy.RETENTION_SNAPSHOT_DAYS,
        where: sql`e.snapshot_json is not null and ${age(policy.RETENTION_SNAPSHOT_DAYS)}`,
      },
      {
        key: 'errors' as const,
        days: policy.RETENTION_ERROR_DAYS,
        where: sql`e.kind = 'error' and ${age(policy.RETENTION_ERROR_DAYS)}`,
      },
      {
        key: 'events' as const,
        days: policy.RETENTION_EVENT_DAYS,
        where: sql`e.kind <> 'error' and ${age(policy.RETENTION_EVENT_DAYS)}`,
      },
    ]
    for (const category of categories) {
      if (!category.days) continue
      const eligible = sql`select e.id from watch_events e where ${delivered} and ${category.where} order by e.created_at,e.id limit ${RETENTION_BATCH_SIZE} for update of e skip locked`
      const result = options.apply
        ? category.key === 'snapshots'
          ? await tx.execute(
              sql`with eligible as (${eligible}) update watch_events set snapshot_json = null from eligible where watch_events.id = eligible.id returning watch_events.id`,
            )
          : await tx.execute(
              sql`with eligible as (${eligible}) delete from watch_events using eligible where watch_events.id = eligible.id returning watch_events.id`,
            )
        : await tx.execute(eligible)
      summary[category.key] = result.length
    }
    if (policy.RETENTION_API_REQUEST_DAYS) {
      // Keep at least 30 complete Prague calendar days, including today's reservations.
      const boundary = apiRetentionBoundary(
        now,
        policy.RETENTION_API_REQUEST_DAYS,
      )
      const eligible = sql`select id from cuzk_api_requests where day < ${boundary}::date order by day,id limit ${RETENTION_BATCH_SIZE} for update skip locked`
      const result = options.apply
        ? await tx.execute(
            sql`with eligible as (${eligible}) delete from cuzk_api_requests using eligible where cuzk_api_requests.id = eligible.id returning cuzk_api_requests.id`,
          )
        : await tx.execute(eligible)
      summary.apiRequests = result.length
    }
    return summary
  })
}
