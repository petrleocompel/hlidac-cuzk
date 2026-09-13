import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, watchEvents } from '#/db/schema'
import {
  buildParcelSnapshot,
  diffSnapshots,
  parseSnapshot,
} from '#/lib/cuzk/snapshot'
import type { RizeniCache, SnapshotChange } from '#/lib/cuzk/snapshot'
import {
  mergeTrackedSources,
  planRizeniFollowUp,
  reconcileTrackedRizeni,
  trackedFromSnapshot,
} from '#/lib/cuzk/rizeni-follow'
import {
  fetchRizeniDetails,
  loadTrackedRizeni,
  saveTrackedRizeni,
} from '#/lib/cuzk/rizeni-tracking'
import { CuzkUnavailableError, MANUAL_REFRESH_SECONDS } from '#/lib/cuzk/policy'
import { enqueueNotifications } from '#/lib/notifications/outbox'

export type PollResult = {
  status: 'checked' | 'busy' | 'not_due' | 'superseded' | 'cooldown'
  queued: number
  changes: SnapshotChange[]
}

const POLL_TIMEOUT_MS = 90_000

function skipped(
  status: 'busy' | 'not_due' | 'superseded' | 'cooldown',
): PollResult {
  return { status, queued: 0, changes: [] }
}

/** Used by both cron and manual refresh. Lease time always comes from PostgreSQL. */
export async function pollWatchById(
  watchId: string,
  now = new Date(),
  options: {
    onlyIfDue?: boolean
    manual?: boolean
    rizeniCache?: RizeniCache
  } = {},
): Promise<PollResult> {
  const token = crypto.randomUUID()
  const due = and(
    eq(parcelWatches.enabled, true),
    sql`coalesce(${parcelWatches.nextCheckAt}, ${parcelWatches.lastCheckedAt} + ${parcelWatches.pollIntervalMinutes} * interval '1 minute', '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz`,
  )
  // Atomic claim also reads the latest committed snapshot. No DB transaction is
  // held open while calling ČÚZK, and a busy watch is skipped rather than waited on.
  const claimed = await db
    .update(parcelWatches)
    .set({
      ...(options.manual
        ? {
            manualRefreshAfter: sql`clock_timestamp() + ${MANUAL_REFRESH_SECONDS} * interval '1 second'`,
          }
        : {}),
      lastAttemptAt: now,
      pollClaimToken: token,
      pollLockedUntil: sql`clock_timestamp() + interval '2 minutes'`,
    })
    .where(
      and(
        eq(parcelWatches.id, watchId),
        or(
          isNull(parcelWatches.pollLockedUntil),
          lte(parcelWatches.pollLockedUntil, sql`clock_timestamp()`),
        ),
        options.onlyIfDue ? due : undefined,
        options.manual
          ? or(
              isNull(parcelWatches.manualRefreshAfter),
              lte(parcelWatches.manualRefreshAfter, sql`clock_timestamp()`),
            )
          : undefined,
      ),
    )
    .returning()
  const watch = claimed.at(0)
  if (!watch) {
    const existing = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, watchId),
      columns: { id: true },
    })
    if (!existing) throw new Error('not_found')
    if (options.manual) {
      const states = await db
        .select({
          cooldown: sql<boolean>`${parcelWatches.manualRefreshAfter} > clock_timestamp()`,
        })
        .from(parcelWatches)
        .where(eq(parcelWatches.id, watchId))
      if (states.at(0)?.cooldown) return skipped('cooldown')
    }
    return skipped(options.onlyIfDue ? 'not_due' : 'busy')
  }

  const ownsLease = and(
    eq(parcelWatches.id, watch.id),
    eq(parcelWatches.pollClaimToken, token),
    gt(parcelWatches.pollLockedUntil, sql`clock_timestamp()`),
  )
  try {
    const signal = AbortSignal.timeout(POLL_TIMEOUT_MS)
    const previous = parseSnapshot(watch.lastSnapshotJson)
    // Older instances only have řízení history inside the last snapshot.
    const trackedBefore = mergeTrackedSources(
      await loadTrackedRizeni(watch.id),
      trackedFromSnapshot(previous, now),
    )
    const next = await buildParcelSnapshot(
      watch.isknId,
      now,
      signal,
      options.rizeniCache,
    )
    signal.throwIfAborted()
    const plan = planRizeniFollowUp(
      trackedBefore,
      new Set(next.rizeni.map((r) => r.id)),
      now,
    )
    // Řízení detached from the parcel are still queried on their own detail.
    const fetched = await fetchRizeniDetails(
      plan.fetch.map((row) => row.rizeniId),
      now,
      signal,
      options.rizeniCache,
    )
    signal.throwIfAborted()
    const tracking = reconcileTrackedRizeni({
      tracked: trackedBefore,
      plomby: next.rizeni,
      fetched,
      ended: plan.ended,
      now,
    })
    // Keep the last known detail in the snapshot: a failed detail request must
    // not present every field as newly empty.
    const merged = new Map(
      tracking.rows
        .filter((row) => row.isPlomba && row.detail)
        .map((row) => [row.rizeniId, row.detail!]),
    )
    next.rizeni = next.rizeni.map((r) => merged.get(r.id) ?? r)
    const changes = [...diffSnapshots(previous, next), ...tracking.changes]

    return await db.transaction(async (tx): Promise<PollResult> => {
      // Fence the entire snapshot/event/outbox commit against an expired lease
      // or a replacement worker. The row lock lasts until this transaction ends.
      const updated = await tx
        .update(parcelWatches)
        .set({
          lastCheckedAt: now,
          lastSuccessfulCheckAt: now,
          nextCheckAt: sql`${now.toISOString()}::timestamptz + ${parcelWatches.pollIntervalMinutes} * interval '1 minute'`,
          lastSnapshotJson: next,
          lastError: null,
          updatedAt: now,
          pollClaimToken: null,
          pollLockedUntil: null,
        })
        .where(ownsLease)
        .returning({ id: parcelWatches.id })
      if (!updated.length) return skipped('superseded')

      await saveTrackedRizeni(tx, watch.id, tracking.rows, now)

      let queued = 0
      for (const change of changes) {
        const [event] = await tx
          .insert(watchEvents)
          .values({
            watchId: watch.id,
            kind: change.kind,
            payloadJson: change,
            // Keep the snapshot behind this change; the watch row is overwritten.
            snapshotJson: next,
            createdAt: now,
          })
          .returning()
        queued += await enqueueNotifications(
          tx,
          event.id,
          watch.userId,
          watch.label,
          change,
          now,
        )
      }
      return { status: 'checked', queued, changes }
    })
  } catch (error) {
    const message =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'Kontrola ČÚZK překročila časový limit 90 sekund.'
        : error instanceof Error
          ? error.message
          : String(error)
    // An older failed request must not overwrite a newer successful check.
    const recorded = await db.transaction(async (tx) => {
      const updated = await tx
        .update(parcelWatches)
        .set({
          lastCheckedAt: now,
          nextCheckAt:
            error instanceof CuzkUnavailableError && error.retryAt
              ? new Date(
                  Math.max(now.getTime() + 300_000, error.retryAt.getTime()),
                )
              : new Date(now.getTime() + 300_000),
          lastError: message,
          updatedAt: now,
          pollClaimToken: null,
          pollLockedUntil: null,
        })
        .where(ownsLease)
        .returning({ id: parcelWatches.id })
      if (!updated.length) return false
      await tx.insert(watchEvents).values({
        watchId: watch.id,
        kind: 'error',
        payloadJson: { message },
        createdAt: now,
      })
      return true
    })
    if (!recorded) return skipped('superseded')
    throw new Error(message, { cause: error })
  } finally {
    // Also release an expired claim if we are still its owner. Never clear a
    // replacement worker's token. A hard crash instead recovers by lease expiry.
    await db
      .update(parcelWatches)
      .set({ pollClaimToken: null, pollLockedUntil: null })
      .where(
        and(
          eq(parcelWatches.id, watch.id),
          eq(parcelWatches.pollClaimToken, token),
        ),
      )
  }
}

export async function pollDueWatches(now = new Date()): Promise<{
  checked: number
  queued: number
  errors: number
  skipped: number
}> {
  const watches = await db.query.parcelWatches.findMany({
    where: and(
      eq(parcelWatches.enabled, true),
      sql`coalesce(${parcelWatches.nextCheckAt}, ${parcelWatches.lastCheckedAt} + ${parcelWatches.pollIntervalMinutes} * interval '1 minute', '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz`,
    ),
    columns: { id: true },
    orderBy: [sql`${parcelWatches.nextCheckAt} asc nulls first`],
  })
  const rizeniCache: RizeniCache = new Map()
  const result = { checked: 0, queued: 0, errors: 0, skipped: 0 }
  for (const watch of watches) {
    try {
      const poll = await pollWatchById(watch.id, now, {
        onlyIfDue: true,
        rizeniCache,
      })
      if (poll.status !== 'checked') {
        result.skipped += 1
        continue
      }
      result.checked += 1
      result.queued += poll.queued
    } catch (error) {
      // pollWatchById records errors while it owns the lease. Do not write here:
      // another worker may already have replaced that check by the time we catch.
      result.checked += 1
      result.errors += 1
      if (
        error instanceof Error &&
        error.cause instanceof CuzkUnavailableError &&
        error.cause.retryAt
      ) {
        result.skipped += watches.length - result.checked - result.skipped
        break
      }
    }
  }
  return result
}
