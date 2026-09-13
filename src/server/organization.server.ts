import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import { BulkWatchInput, OrganizationInput } from '#/lib/watch-organization'

export async function saveWatchOrganization(userId: string, input: unknown) {
  const data = OrganizationInput.parse(input)
  const rows = await db
    .update(parcelWatches)
    .set({
      label: data.label,
      notes: data.notes,
      tags: data.tags,
      updatedAt: new Date(),
    })
    .where(and(eq(parcelWatches.id, data.id), eq(parcelWatches.userId, userId)))
    .returning({ id: parcelWatches.id })
  if (!rows.length) throw new Error('Sledování není dostupné.')
  return { ok: true }
}
export async function changeWatchBatch(userId: string, input: unknown) {
  const data = BulkWatchInput.parse(input)
  return db.transaction(async (tx) => {
    // Lock in a stable order to serialize overlapping batches without deadlocks.
    const owned = await tx
      .select({ id: parcelWatches.id })
      .from(parcelWatches)
      .where(
        and(
          eq(parcelWatches.userId, userId),
          inArray(parcelWatches.id, data.ids),
        ),
      )
      .orderBy(parcelWatches.id)
      .for('update')
    if (owned.length !== data.ids.length)
      throw new Error(
        'Některé sledování není dostupné. Žádná změna se neuložila.',
      )
    await tx
      .update(parcelWatches)
      .set({
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.pollIntervalMinutes !== undefined
          ? { pollIntervalMinutes: data.pollIntervalMinutes }
          : {}),
        ...(data.enabled === true
          ? {
              nextCheckAt: sql`case when not ${parcelWatches.enabled} then clock_timestamp() else ${data.pollIntervalMinutes !== undefined ? sql`coalesce(${parcelWatches.lastAttemptAt},clock_timestamp()) + ${data.pollIntervalMinutes} * interval '1 minute'` : parcelWatches.nextCheckAt} end`,
            }
          : data.pollIntervalMinutes !== undefined
            ? {
                nextCheckAt: sql`coalesce(${parcelWatches.lastAttemptAt},clock_timestamp()) + ${data.pollIntervalMinutes} * interval '1 minute'`,
              }
            : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(parcelWatches.userId, userId),
          inArray(parcelWatches.id, data.ids),
        ),
      )
    return { updated: owned.length }
  })
}
