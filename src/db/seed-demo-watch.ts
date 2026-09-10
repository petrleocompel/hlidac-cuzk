import { and, eq } from 'drizzle-orm'
import { db } from './index'
import { parcelWatches } from './schema'
import { resolveIsknId } from '#/lib/cuzk/client'

/** Demo watch used for smoke-testing against live ČÚZK. */
export const DEMO_WATCH = {
  label: 'Vejprnice 1133/77',
  kuCode: '777552',
  kuName: 'Vejprnice',
  parcelNumber: 1133,
  parcelSubdivision: 77,
  druhCislovani: 2 as const,
  pollIntervalMinutes: 60,
}

export async function seedDemoWatch(userId: string): Promise<{
  status: 'created' | 'exists'
  watchId: string
  isknId: string
}> {
  const existing = await db.query.parcelWatches.findFirst({
    where: and(
      eq(parcelWatches.userId, userId),
      eq(parcelWatches.kuCode, DEMO_WATCH.kuCode),
      eq(parcelWatches.parcelNumber, DEMO_WATCH.parcelNumber),
      eq(parcelWatches.parcelSubdivision, DEMO_WATCH.parcelSubdivision),
    ),
  })
  if (existing) {
    return {
      status: 'exists',
      watchId: existing.id,
      isknId: existing.isknId,
    }
  }

  const { isknId } = await resolveIsknId({
    kodKatastralnihoUzemi: DEMO_WATCH.kuCode,
    typParcely: 'PKN',
    druhCislovaniParcely: DEMO_WATCH.druhCislovani,
    kmenoveCisloParcely: DEMO_WATCH.parcelNumber,
    poddeleniCislaParcely: DEMO_WATCH.parcelSubdivision,
  })

  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId,
      label: DEMO_WATCH.label,
      kuCode: DEMO_WATCH.kuCode,
      kuName: DEMO_WATCH.kuName,
      parcelNumber: DEMO_WATCH.parcelNumber,
      parcelSubdivision: DEMO_WATCH.parcelSubdivision,
      druhCislovani: DEMO_WATCH.druhCislovani,
      isknId,
      pollIntervalMinutes: DEMO_WATCH.pollIntervalMinutes,
    })
    .returning()

  return { status: 'created', watchId: row.id, isknId }
}
