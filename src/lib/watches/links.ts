import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { parcelWatches, watchLinks } from '#/db/schema'

export const LinkInput = z.object({
  fromWatchId: z.uuid(),
  toWatchId: z.uuid(),
  note: z.string().trim().max(500).default(''),
})
export async function linkWatches(userId: string, input: unknown) {
  const data = LinkInput.parse(input)
  if (data.fromWatchId === data.toWatchId)
    throw new Error('Sledování nelze propojit samo se sebou.')
  return db.transaction(async (tx) => {
    const owned = await tx
      .select()
      .from(parcelWatches)
      .where(
        and(
          eq(parcelWatches.userId, userId),
          inArray(parcelWatches.id, [data.fromWatchId, data.toWatchId]),
        ),
      )
      .orderBy(parcelWatches.id)
      .for('update')
    if (owned.length !== 2 || owned.some((w) => w.objectType !== 'parcel'))
      throw new Error('Vyberte dvě vlastní sledování parcel.')
    const existing = await tx
      .select()
      .from(watchLinks)
      .where(
        and(
          eq(watchLinks.fromWatchId, data.fromWatchId),
          eq(watchLinks.toWatchId, data.toWatchId),
        ),
      )
    if (existing.length) return { ok: true }
    for (const watch of owned) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(watchLinks)
        .where(
          or(
            eq(watchLinks.fromWatchId, watch.id),
            eq(watchLinks.toWatchId, watch.id),
          ),
        )
      if (row.n >= 20)
        throw new Error(
          'Jedno sledování může mít nejvýše 20 ručních návazností.',
        )
    }
    await tx.insert(watchLinks).values({ ...data, userId })
    return { ok: true }
  })
}
export async function readWatchLinks(userId: string, watchId: string) {
  const owned = await db
    .select({
      id: parcelWatches.id,
      label: parcelWatches.label,
      isknId: parcelWatches.isknId,
      type: parcelWatches.objectType,
    })
    .from(parcelWatches)
    .where(eq(parcelWatches.userId, userId))
    .orderBy(parcelWatches.label, parcelWatches.id)
  if (!owned.some((w) => w.id === watchId))
    throw new Error('Sledování není dostupné.')
  const links = await db
    .select()
    .from(watchLinks)
    .where(
      and(
        eq(watchLinks.userId, userId),
        or(
          eq(watchLinks.fromWatchId, watchId),
          eq(watchLinks.toWatchId, watchId),
        ),
      ),
    )
    .orderBy(watchLinks.createdAt, watchLinks.id)
  const names = new Map(owned.map((w) => [w.id, w]))
  return {
    candidates: owned.filter((w) => w.id !== watchId && w.type === 'parcel'),
    links: links.map((r) => ({
      id: r.id,
      note: r.note,
      direction:
        r.fromWatchId === watchId
          ? ('outgoing' as const)
          : ('incoming' as const),
      watchId: r.fromWatchId === watchId ? r.toWatchId : r.fromWatchId,
      label:
        names.get(r.fromWatchId === watchId ? r.toWatchId : r.fromWatchId)
          ?.label ?? 'Sledování',
    })),
  }
}
export async function unlinkWatches(userId: string, id: string) {
  z.uuid().parse(id)
  await db
    .delete(watchLinks)
    .where(and(eq(watchLinks.id, id), eq(watchLinks.userId, userId)))
  return { ok: true }
}
