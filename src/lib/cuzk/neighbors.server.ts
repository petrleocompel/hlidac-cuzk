import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, user } from '#/db/schema'
import { getNeighborParcels } from './client'
import { verifiedFromParcela } from './watch-create'
import type { NeighborSelectionInput, VerifiedParcel } from './neighbor-types'
import {
  MAX_NEIGHBOR_SELECTION,
  NeighborSelection,
} from './neighbor-types'
import { cuzkPolicy, DAILY_API_LIMIT, DEFAULT_POLL_MINUTES } from './policy'

export {
  MAX_NEIGHBOR_SELECTION,
  NeighborSelection,
  type NeighborPreview,
  type NeighborSelectionInput,
  type VerifiedParcel,
} from './neighbor-types'

const MAX_PREVIEW = 100

async function ownedWatch(userId: string, watchId: string) {
  const watch = await db.query.parcelWatches.findFirst({
    where: and(eq(parcelWatches.id, watchId), eq(parcelWatches.userId, userId)),
  })
  if (!watch) throw new Error('Sledování nebylo nalezeno.')
  return watch
}

async function candidates(isknId: string) {
  const result = await getNeighborParcels(isknId)
  if (result.data != null && !Array.isArray(result.data))
    throw new Error('ČÚZK vrátilo neplatný seznam sousedních parcel.')
  const parcels = new Map<string, VerifiedParcel>()
  let unsupported = 0
  for (const parcel of result.data ?? []) {
    if (String(parcel.id) === isknId) continue
    if (parcel.typParcely !== 'PKN' || !Number.isSafeInteger(parcel.id)) {
      unsupported++
      continue
    }
    try {
      const verified = verifiedFromParcela(parcel)
      parcels.set(verified.isknId, verified)
    } catch {
      unsupported++
    }
  }
  return {
    parcels: [...parcels.values()],
    unsupported,
    dataAsOf: result.aktualnostDatK ?? null,
  }
}

/** Read only, with ownership checked before spending the shared API quota. */
export async function previewNeighbors(userId: string, watchId: string) {
  const watch = await ownedWatch(userId, watchId)
  const result = await candidates(watch.isknId)
  const existing = await db
    .select({ isknId: parcelWatches.isknId, id: parcelWatches.id })
    .from(parcelWatches)
    .where(eq(parcelWatches.userId, userId))
  const watched = new Map(existing.map((row) => [row.isknId, row.id]))
  return {
    parcels: result.parcels
      .slice(0, MAX_PREVIEW)
      .map((parcel) => ({
        ...parcel,
        alreadyWatchedId: watched.get(parcel.isknId) ?? null,
      })),
    total: result.parcels.length,
    truncated: result.parcels.length > MAX_PREVIEW,
    unsupported: result.unsupported,
    dataAsOf: result.dataAsOf,
    availableSlots: Math.max(
      0,
      cuzkPolicy().MAX_WATCHES_PER_USER - existing.length,
    ),
    selectionLimit: MAX_NEIGHBOR_SELECTION,
    dailyLimit: DAILY_API_LIMIT,
  }
}

/**
 * Confirm against a fresh server answer, never client-supplied identification.
 * One bounded batch is atomic; new watches do not recursively discover neighbors.
 */
export async function addSelectedNeighbors(
  userId: string,
  input: NeighborSelectionInput,
) {
  const data = NeighborSelection.parse(input)
  const watch = await ownedWatch(userId, data.watchId)
  const result = await candidates(watch.isknId)
  const available = new Map(
    result.parcels
      .slice(0, MAX_PREVIEW)
      .map((parcel) => [parcel.isknId, parcel]),
  )
  const ids = [...new Set(data.ids)]
  if (ids.some((id) => !available.has(id)))
    throw new Error('Výběr již neodpovídá sousedním parcelám. Obnovte náhled.')
  return db.transaction(async (tx) => {
    // Match the common per-user insertion lock to enforce capacity under races.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
    const parent = await tx
      .select({ id: parcelWatches.id })
      .from(parcelWatches)
      .where(
        and(
          eq(parcelWatches.id, data.watchId),
          eq(parcelWatches.userId, userId),
        ),
      )
      .for('update')
    if (!parent.length) throw new Error('Sledování nebylo nalezeno.')
    const existing = await tx
      .select({ isknId: parcelWatches.isknId })
      .from(parcelWatches)
      .where(
        and(
          eq(parcelWatches.userId, userId),
          inArray(parcelWatches.isknId, ids),
        ),
      )
    const present = new Set(existing.map((row) => row.isknId))
    const newIds = ids.filter((id) => !present.has(id))
    const [current] = await tx
      .select({ total: count() })
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, userId))
    if (current.total + newIds.length > cuzkPolicy().MAX_WATCHES_PER_USER)
      throw new Error('Výběr překračuje limit sledování. Vyberte méně parcel.')
    if (!newIds.length) return { created: 0, skipped: ids.length }
    const now = new Date()
    await tx.insert(parcelWatches).values(
      newIds.map((id) => {
        const parcel = available.get(id)!
        const number = `${parcel.druhCislovani === 1 ? 'st. ' : ''}${parcel.parcelNumber}${parcel.parcelSubdivision ? `/${parcel.parcelSubdivision}` : ''}`
        return {
          userId,
          isknId: id,
          label: `${parcel.kuName} ${number}`.slice(0, 200),
          kuCode: parcel.kuCode,
          kuName: parcel.kuName,
          parcelNumber: parcel.parcelNumber,
          parcelSubdivision: parcel.parcelSubdivision,
          druhCislovani: parcel.druhCislovani,
          pollIntervalMinutes: DEFAULT_POLL_MINUTES,
          nextCheckAt: now,
        }
      }),
    )
    return { created: newIds.length, skipped: ids.length - newIds.length }
  })
}
