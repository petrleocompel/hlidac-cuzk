import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import { parseSnapshot } from '#/lib/cuzk/snapshot'

export type NavStats = {
  watchCount: number
  plombaCount: number
}

export const getNavStats = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NavStats> => {
    const session = await requireSession()
    const rows = await db.query.parcelWatches.findMany({
      where: eq(parcelWatches.userId, session.user.id),
      columns: {
        enabled: true,
        lastSnapshotJson: true,
      },
    })

    let plombaCount = 0
    for (const row of rows) {
      if (!row.enabled) continue
      const snapshot = parseSnapshot(row.lastSnapshotJson)
      plombaCount += snapshot?.rizeni.length ?? 0
    }

    return {
      watchCount: rows.length,
      plombaCount,
    }
  },
)
