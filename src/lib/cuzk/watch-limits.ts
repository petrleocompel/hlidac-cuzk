import { count, eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, user } from '#/db/schema'
import { cuzkPolicy } from './policy'

/** PostgreSQL unique_violation, wherever Drizzle wrapped the driver error. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (current) {
    if ((current as { code?: string }).code === '23505') return true
    current = current instanceof Error ? current.cause : null
  }
  return false
}

export async function assertWatchCapacity(userId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(parcelWatches)
    .where(eq(parcelWatches.userId, userId))
  if (row.count >= cuzkPolicy().MAX_WATCHES_PER_USER)
    throw new Error(
      `Limit ${cuzkPolicy().MAX_WATCHES_PER_USER} sledování na uživatele byl dosažen.`,
    )
}

export async function insertWatchWithinLimit(
  values: typeof parcelWatches.$inferInsert,
) {
  return db.transaction(async (tx) => {
    const owners = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, values.userId))
      .for('update')
    if (!owners.length) throw new Error('not_found')
    const [row] = await tx
      .select({ count: count() })
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, values.userId))
    if (row.count >= cuzkPolicy().MAX_WATCHES_PER_USER)
      throw new Error(
        `Limit ${cuzkPolicy().MAX_WATCHES_PER_USER} sledování na uživatele byl dosažen.`,
      )
    try {
      const [watch] = await tx.insert(parcelWatches).values(values).returning()
      return watch
    } catch (error) {
      // One subscription per user and object is enforced by a unique index.
      // The driver error is wrapped by Drizzle, so check the cause chain too.
      if (isUniqueViolation(error))
        throw new Error('Tuto parcelu už sledujete.')
      throw error
    }
  })
}
