import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, watchEvents } from '#/db/schema'
import {
  buildParcelSnapshot,
  diffSnapshots,
  parseSnapshot,
} from '#/lib/cuzk/snapshot'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'
import { enqueueNotifications } from '#/lib/notifications/outbox'

export type PollResult = {
  status: 'checked' | 'busy' | 'not_due' | 'superseded'
  queued: number
  changes: SnapshotChange[]
}

const POLL_TIMEOUT_MS = 90_000

function skipped(status: 'busy' | 'not_due' | 'superseded'): PollResult {
  return { status, queued: 0, changes: [] }
}

/** Used by both cron and manual refresh. Lease time always comes from PostgreSQL. */
export async function pollWatchById(
  watchId: string,
  now = new Date(),
  options: { onlyIfDue?: boolean } = {},
): Promise<PollResult> {
  const token = crypto.randomUUID()
  const due = and(
    eq(parcelWatches.enabled, true),
    or(
      isNull(parcelWatches.lastCheckedAt),
      sql`${parcelWatches.lastCheckedAt} <= ${now.toISOString()}::timestamptz - ${parcelWatches.pollIntervalMinutes} * interval '1 minute'`,
    ),
  )
  // Atomic claim also reads the latest committed snapshot. No DB transaction is
  // held open while calling ČÚZK, and a busy watch is skipped rather than waited on.
  const claimed = await db
    .update(parcelWatches)
    .set({
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
    return skipped(options.onlyIfDue ? 'not_due' : 'busy')
  }

  const ownsLease = and(
    eq(parcelWatches.id, watch.id),
    eq(parcelWatches.pollClaimToken, token),
    gt(parcelWatches.pollLockedUntil, sql`clock_timestamp()`),
  )
  try {
    const signal = AbortSignal.timeout(POLL_TIMEOUT_MS)
    const next = await buildParcelSnapshot(watch.isknId, now, signal)
    signal.throwIfAborted()
    const changes = diffSnapshots(parseSnapshot(watch.lastSnapshotJson), next)

    return await db.transaction(async (tx): Promise<PollResult> => {
      // Fence the entire snapshot/event/outbox commit against an expired lease
      // or a replacement worker. The row lock lasts until this transaction ends.
      const updated = await tx
        .update(parcelWatches)
        .set({
          lastCheckedAt: now,
          lastSnapshotJson: next,
          lastError: null,
          updatedAt: now,
          pollClaimToken: null,
          pollLockedUntil: null,
        })
        .where(ownsLease)
        .returning({ id: parcelWatches.id })
      if (!updated.length) return skipped('superseded')

      let queued = 0
      for (const change of changes) {
        const [event] = await tx
          .insert(watchEvents)
          .values({
            watchId: watch.id,
            kind: change.kind,
            payloadJson: change,
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
      or(
        isNull(parcelWatches.lastCheckedAt),
        sql`${parcelWatches.lastCheckedAt} <= ${now.toISOString()}::timestamptz - ${parcelWatches.pollIntervalMinutes} * interval '1 minute'`,
      ),
    ),
    columns: { id: true },
  })
  const result = { checked: 0, queued: 0, errors: 0, skipped: 0 }
  for (const watch of watches) {
    try {
      const poll = await pollWatchById(watch.id, now, { onlyIfDue: true })
      if (poll.status !== 'checked') {
        result.skipped += 1
        continue
      }
      result.checked += 1
      result.queued += poll.queued
    } catch {
      // pollWatchById records errors while it owns the lease. Do not write here:
      // another worker may already have replaced that check by the time we catch.
      result.checked += 1
      result.errors += 1
    }
  }
  return result
}
