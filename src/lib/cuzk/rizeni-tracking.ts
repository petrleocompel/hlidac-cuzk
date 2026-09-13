import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, watchRizeni } from '#/db/schema'
import type { WatchRizeni } from '#/db/schema'
import { getRizeniById } from './client'
import { normalizeRizeni, parseRizeniSnapshot } from './snapshot'
import type { RizeniCache, RizeniSnapshot } from './snapshot'
import {
  CuzkHttpError,
  CuzkUnavailableError,
  MAX_FOLLOWED_RIZENI,
} from './policy'
import type { RizeniFetchOutcome, TrackedRizeni } from './rizeni-follow'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function identity(detail: RizeniSnapshot | null) {
  return {
    typRizeni: detail?.typRizeni ?? null,
    poradoveCislo: detail?.poradoveCislo ?? null,
    rok: detail?.rok ?? null,
    kodPracoviste: detail?.kodPracoviste ?? null,
  }
}

export async function fetchRizeniDetails(
  ids: string[],
  now: Date,
  signal?: AbortSignal,
  cache: RizeniCache = new Map(),
): Promise<Map<string, RizeniFetchOutcome>> {
  const results = new Map<string, RizeniFetchOutcome>()
  for (const id of ids) {
    signal?.throwIfAborted()
    try {
      let pending = cache.get(id)
      if (!pending) {
        pending = getRizeniById(id, signal)
        cache.set(id, pending)
      }
      const detail = (await pending).data
      results.set(
        id,
        detail
          ? { status: 'detail', detail: normalizeRizeni(detail, now) }
          : { status: 'unavailable' },
      )
    } catch (error) {
      // 404 is a documented answer: the řízení is no longer published.
      if (error instanceof CuzkHttpError && error.status === 404) {
        results.set(id, { status: 'unavailable' })
        continue
      }
      if (
        error instanceof CuzkUnavailableError ||
        (error instanceof CuzkHttpError &&
          [401, 403, 429].includes(error.status))
      )
        throw error
      signal?.throwIfAborted()
      results.set(id, {
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Detail řízení se nepodařilo načíst.',
      })
    }
  }
  return results
}

function toTracked(row: WatchRizeni): TrackedRizeni {
  return {
    rizeniId: row.rizeniId,
    source: row.source,
    isPlomba: row.isPlomba,
    firstSeenAt: row.firstSeenAt,
    detachedAt: row.detachedAt,
    followUntil: row.followUntil,
    followEndedAt: row.followEndedAt,
    followEndedReason: row.followEndedReason,
    detail: parseRizeniSnapshot(row.detailJson),
    detailFetchedAt: row.detailFetchedAt,
    lastError: row.lastError,
  }
}

export async function loadTrackedRizeni(
  watchId: string,
  tx: Transaction | typeof db = db,
): Promise<TrackedRizeni[]> {
  const rows = await tx
    .select()
    .from(watchRizeni)
    .where(eq(watchRizeni.watchId, watchId))
  return rows.map(toTracked)
}

export async function saveTrackedRizeni(
  tx: Transaction,
  watchId: string,
  rows: TrackedRizeni[],
  now: Date,
): Promise<void> {
  for (const row of rows) {
    const values = {
      source: row.source,
      ...identity(row.detail),
      isPlomba: row.isPlomba,
      detachedAt: row.detachedAt,
      followUntil: row.followUntil,
      followEndedAt: row.followEndedAt,
      followEndedReason: row.followEndedReason,
      detailJson: row.detail,
      detailFetchedAt: row.detailFetchedAt,
      lastError: row.lastError,
      updatedAt: now,
    }
    await tx
      .insert(watchRizeni)
      .values({
        watchId,
        rizeniId: row.rizeniId,
        firstSeenAt: row.firstSeenAt,
        createdAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: [watchRizeni.watchId, watchRizeni.rizeniId],
        set: values,
      })
  }
}

/** Counts follows that still spend an API call on every check. */
async function countActiveFollows(
  watchId: string,
  tx: Transaction | typeof db = db,
): Promise<number> {
  const rows = await tx
    .select({ rizeniId: watchRizeni.rizeniId })
    .from(watchRizeni)
    .where(
      and(
        eq(watchRizeni.watchId, watchId),
        eq(watchRizeni.isPlomba, false),
        isNull(watchRizeni.followEndedAt),
      ),
    )
  return rows.length
}

/**
 * Adds a řízení verified in ČÚZK to a watch the user owns. Ownership, the
 * capacity check and the upsert share one transaction.
 */
export async function followKnownRizeni(
  watchId: string,
  userId: string,
  detail: RizeniSnapshot,
  now = new Date(),
): Promise<{ alreadyTracked: boolean }> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: parcelWatches.id })
      .from(parcelWatches)
      .where(
        and(eq(parcelWatches.id, watchId), eq(parcelWatches.userId, userId)),
      )
    if (!owned.length) throw new Error('not_found')

    const existing = await tx
      .select()
      .from(watchRizeni)
      .where(
        and(
          eq(watchRizeni.watchId, watchId),
          eq(watchRizeni.rizeniId, detail.id),
        ),
      )
    const before = existing.at(0)
    if (before && (before.isPlomba || !before.followEndedAt))
      return { alreadyTracked: true }

    if ((await countActiveFollows(watchId, tx)) >= MAX_FOLLOWED_RIZENI)
      throw new Error(
        `Sledovat lze nejvýše ${MAX_FOLLOWED_RIZENI} řízení nad rámec plomb. Ukončete jiné sledování.`,
      )

    const values = {
      source: before?.source ?? ('manual' as const),
      ...identity(detail),
      isPlomba: false,
      // A manual follow has no deadline; the user ends it.
      followUntil: null,
      followEndedAt: null,
      followEndedReason: null,
      detailJson: detail,
      detailFetchedAt: now,
      lastError: null,
      updatedAt: now,
    }
    await tx
      .insert(watchRizeni)
      .values({
        watchId,
        rizeniId: detail.id,
        firstSeenAt: before?.firstSeenAt ?? now,
        detachedAt: before?.detachedAt ?? null,
        createdAt: now,
        ...values,
      })
      .onConflictDoUpdate({
        target: [watchRizeni.watchId, watchRizeni.rizeniId],
        set: values,
      })
    return { alreadyTracked: false }
  })
}

/** Stops the extra requests; the recorded history stays. */
export async function stopFollowingRizeni(
  id: string,
  userId: string,
  now = new Date(),
): Promise<void> {
  const ownedWatches = db
    .select({ id: parcelWatches.id })
    .from(parcelWatches)
    .where(eq(parcelWatches.userId, userId))
  // Ownership is part of the UPDATE, including races with deletion.
  const updated = await db
    .update(watchRizeni)
    .set({
      followEndedAt: now,
      followEndedReason: 'user',
      followUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(watchRizeni.id, id),
        inArray(watchRizeni.watchId, ownedWatches),
        isNull(watchRizeni.followEndedAt),
        eq(watchRizeni.isPlomba, false),
      ),
    )
    .returning({ id: watchRizeni.id })
  if (!updated.length)
    throw new Error('Sledování řízení nelze ukončit nebo nebylo nalezeno.')
}
