import { eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  cuzkApiControl,
  cuzkApiDailyUsage,
  cuzkApiRequests,
  parcelWatches,
} from '#/db/schema'
import { accountSchema, DAILY_API_LIMIT } from './policy'

export async function getCuzkMetrics() {
  return db.transaction(
    async (tx) => {
      const [clock] = await tx.execute<{ day: string; reset: string }>(sql`
      select to_char(current_timestamp AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD') as day,
      ((date_trunc('day', current_timestamp AT TIME ZONE 'Europe/Prague') + interval '1 day') AT TIME ZONE 'Europe/Prague')::text as reset`)
      const history = await tx.execute<{
        day: string
        reserved: number
        success: number
        errors: number
        pending: number
        retries: number
        averageMs: number
      }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(u.reserved, 0)::int as reserved,
        count(r.id) filter (where r.outcome = 'success')::int as success,
        count(r.id) filter (where r.outcome not in ('success', 'pending'))::int as errors,
        count(r.id) filter (where r.outcome = 'pending')::int as pending,
        count(r.id) filter (where r.attempt > 1)::int as retries,
        coalesce(round(avg(r.duration_ms)), 0)::int as "averageMs"
      from generate_series(${clock.day}::date - 29, ${clock.day}::date, interval '1 day') d(day)
      left join ${cuzkApiDailyUsage} u on u.day = d.day::date
      left join ${cuzkApiRequests} r on r.day = d.day::date
      group by d.day, u.reserved order by d.day desc`)
      const endpoints = await tx
        .select({
          endpoint: cuzkApiRequests.endpoint,
          requests: sql<number>`count(*)::int`,
          errors: sql<number>`count(*) filter (where ${cuzkApiRequests.outcome} not in ('success', 'pending'))::int`,
          averageMs: sql<number>`coalesce(round(avg(${cuzkApiRequests.durationMs})), 0)::int`,
        })
        .from(cuzkApiRequests)
        .where(eq(cuzkApiRequests.day, clock.day))
        .groupBy(cuzkApiRequests.endpoint)
        .orderBy(cuzkApiRequests.endpoint)
      const [demand] = await tx
        .select({
          watches: sql<number>`count(*)::int`,
          minimumDailyCalls: sql<number>`coalesce(ceil(sum(1440.0 / greatest(${parcelWatches.pollIntervalMinutes}, 5))), 0)::int`,
        })
        .from(parcelWatches)
        .where(eq(parcelWatches.enabled, true))
      const controls = await tx
        .select()
        .from(cuzkApiControl)
        .where(eq(cuzkApiControl.id, 'instance'))
      const control = controls.at(0)
      const account = accountSchema.safeParse(control?.accountJson)
      const today = history[0]
      return {
        day: clock.day,
        resetsAt: new Date(clock.reset).toISOString(),
        limit: DAILY_API_LIMIT,
        remaining: Math.max(0, DAILY_API_LIMIT - today.reserved),
        today,
        history: [...history],
        endpoints,
        demand,
        account: account.success ? account.data : null,
        accountCheckedAt: control?.accountCheckedAt?.toISOString() ?? null,
        accountAttemptAt: control?.accountAttemptAt?.toISOString() ?? null,
        accountError: control?.accountError ?? null,
        blockedUntil: control?.blockedUntil?.toISOString() ?? null,
        blockedReason: control?.blockedReason ?? null,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export type CuzkMetrics = Awaited<ReturnType<typeof getCuzkMetrics>>
