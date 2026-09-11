import { count, eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, user } from '#/db/schema'
import { cuzkPolicy } from './policy'

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
    const [watch] = await tx.insert(parcelWatches).values(values).returning()
    return watch
  })
}
