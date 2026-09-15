import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { ensureDbReady } from '#/db/migrate'
import { db } from '#/db'
import { parcelWatches, watchEvents } from '#/db/schema'
import { summarizeEvent } from '#/lib/notifications/message'

export type DashboardFeedEvent = {
  id: string
  watchId: string
  watchLabel: string
  kind: string
  summary: string
  createdAt: string
}

export type DashboardFeed = {
  events: DashboardFeedEvent[]
  last7Days: number
  prev7Days: number
}

const FEED_LIMIT = 30

/** Flat "what changed" feed across every watch the signed-in user owns. */
export const getRecentEvents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DashboardFeed> => {
    const session = await requireSession()
    await ensureDbReady()
    const userId = session.user.id

    const rows = await db
      .select({
        id: watchEvents.id,
        watchId: watchEvents.watchId,
        watchLabel: parcelWatches.label,
        kind: watchEvents.kind,
        payloadJson: watchEvents.payloadJson,
        createdAt: watchEvents.createdAt,
      })
      .from(watchEvents)
      .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
      .where(eq(parcelWatches.userId, userId))
      .orderBy(desc(watchEvents.createdAt), desc(watchEvents.id))
      .limit(FEED_LIMIT)

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const [counts] = await db
      .select({
        last7Days: sql<number>`count(*) filter (where ${watchEvents.createdAt} >= now() - interval '7 days')::int`,
        prev7Days: sql<number>`count(*) filter (where ${watchEvents.createdAt} < now() - interval '7 days')::int`,
      })
      .from(watchEvents)
      .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
      .where(
        and(
          eq(parcelWatches.userId, userId),
          gte(watchEvents.createdAt, fourteenDaysAgo),
        ),
      )

    return {
      events: rows.map((r) => ({
        id: r.id,
        watchId: r.watchId,
        watchLabel: r.watchLabel,
        kind: r.kind,
        summary: summarizeEvent(r),
        createdAt: r.createdAt.toISOString(),
      })),
      last7Days: counts.last7Days,
      prev7Days: counts.prev7Days,
    }
  },
)
