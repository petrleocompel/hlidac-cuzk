import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import type { ParcelWatch } from '#/db/schema'
import { DEMO_WATCH } from '#/db/seed-demo-watch'

export type NewWatchDefaults = {
  /** Demo values are prefilled only when the instance runs in demo mode. */
  demo: boolean
  demoKuCode: string
  demoKuName: string
  demoParcel: string
  /** Objects already watched, so offered links are marked without an API call. */
  watchedObjects: Array<{
    id: string
    objectType: ParcelWatch['objectType']
    isknId: string
  }>
}

export const getNewWatchDefaults = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NewWatchDefaults> => {
    const session = await requireSession()
    const demo = process.env.SEED_DEMO_WATCH === '1'
    return {
      watchedObjects: await db
        .select({
          id: parcelWatches.id,
          objectType: parcelWatches.objectType,
          isknId: parcelWatches.isknId,
        })
        .from(parcelWatches)
        .where(eq(parcelWatches.userId, session.user.id)),
      demo,
      demoKuCode: demo ? DEMO_WATCH.kuCode : '',
      demoKuName: demo ? DEMO_WATCH.kuName : '',
      demoParcel: demo
        ? `${DEMO_WATCH.parcelNumber}/${DEMO_WATCH.parcelSubdivision}`
        : '',
    }
  },
)
