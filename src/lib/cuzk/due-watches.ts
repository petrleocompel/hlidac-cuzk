import { and, asc, eq, gt, isNull, isNotNull, lte, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'

export const POLL_PAGE_SIZE = 100
export type DueCursor = { id: string; nextCheckAt: Date | null }
export function dueCondition(now: Date) {
  return and(
    eq(parcelWatches.enabled, true),
    or(
      lte(parcelWatches.nextCheckAt, now),
      and(
        isNull(parcelWatches.nextCheckAt),
        sql`coalesce(${parcelWatches.lastCheckedAt} + ${parcelWatches.pollIntervalMinutes} * interval '1 minute', '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz`,
      ),
    ),
  )
}
function afterCursor(cursor?: DueCursor) {
  if (!cursor) return undefined
  return cursor.nextCheckAt === null
    ? or(
        isNotNull(parcelWatches.nextCheckAt),
        and(isNull(parcelWatches.nextCheckAt), gt(parcelWatches.id, cursor.id)),
      )
    : or(
        gt(parcelWatches.nextCheckAt, cursor.nextCheckAt),
        and(
          eq(parcelWatches.nextCheckAt, cursor.nextCheckAt),
          gt(parcelWatches.id, cursor.id),
        ),
      )
}
export async function readDueWatchPage(now: Date, cursor?: DueCursor) {
  return db
    .select({ id: parcelWatches.id, nextCheckAt: parcelWatches.nextCheckAt })
    .from(parcelWatches)
    .where(and(dueCondition(now), afterCursor(cursor)))
    .orderBy(
      sql`${parcelWatches.nextCheckAt} asc nulls first`,
      asc(parcelWatches.id),
    )
    .limit(POLL_PAGE_SIZE)
}
export async function countRemainingDue(now: Date, cursor: DueCursor) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(parcelWatches)
    .where(and(dueCondition(now), afterCursor(cursor)))
  return row.count
}
