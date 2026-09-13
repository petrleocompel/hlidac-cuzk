import type { NotificationDelivery } from '../../src/db/schema'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiDailyUsage,
  cuzkApiRequests,
  notificationDeliveries,
  parcelWatches,
  user,
  watchEvents,
} from '../../src/db/schema'
import { runRetention } from '../../src/lib/maintenance/retention'

const now = new Date('2026-09-13T08:00:00Z'),
  old = new Date('2025-01-01T00:00:00Z')
const policy = {
  RETENTION_EVENT_DAYS: 365,
  RETENTION_SNAPSHOT_DAYS: 90,
  RETENTION_ERROR_DAYS: 14,
  RETENTION_API_REQUEST_DAYS: 30,
}
let watchId: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
})
beforeEach(async () => {
  await db.delete(user)
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await db.insert(user).values({
    id: 'retention-owner',
    name: 'Fixture',
    email: 'retention@example.test',
  })
  const [watch] = await db
    .insert(parcelWatches)
    .values({
      userId: 'retention-owner',
      isknId: '1',
      label: 'Fixture',
      lastSnapshotJson: { keep: true },
    })
    .returning()
  watchId = watch.id
})
afterAll(async () => {
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await closeDb()
})
async function event(
  status?: NotificationDelivery['status'],
  kind = 'lv_change',
  createdAt = old,
) {
  const [created] = await db
    .insert(watchEvents)
    .values({
      watchId,
      kind,
      createdAt,
      payloadJson: { keep: 'payload' },
      snapshotJson: { keep: 'snapshot' },
    })
    .returning()
  if (status)
    await db.insert(notificationDeliveries).values({
      eventId: created.id,
      channel: 'gotify',
      title: 'fixture',
      message: 'fixture',
      status,
    })
  return created
}
it('is disabled by default and dry-run leaves all data intact', async () => {
  await event('sent')
  expect(await runRetention({ apply: true, policy: {}, now })).toMatchObject({
    events: 0,
    snapshots: 0,
  })
  expect(await runRetention({ policy, now })).toMatchObject({
    applied: false,
    events: 1,
    snapshots: 1,
  })
  expect(await db.query.watchEvents.findMany()).toHaveLength(1)
  expect((await db.query.watchEvents.findFirst())?.snapshotJson).toEqual({
    keep: 'snapshot',
  })
})
it('preserves every undelivered status and its snapshot while deleting only expired delivered history', async () => {
  const protectedEvents = []
  for (const status of ['pending', 'processing', 'deferred', 'failed'] as const)
    protectedEvents.push(await event(status))
  await event('sent')
  await event()
  await event(undefined, 'error', new Date('2026-08-20T00:00:00Z'))
  const young = await event(
    undefined,
    'lv_change',
    new Date('2026-09-12T00:00:00Z'),
  )
  expect(await runRetention({ apply: true, policy, now })).toMatchObject({
    events: 2,
    errors: 1,
  })
  const remaining = await db.query.watchEvents.findMany()
  expect(remaining.map((e) => e.id).sort()).toEqual(
    [...protectedEvents.map((e) => e.id), young.id].sort(),
  )
  expect(remaining.every((e) => e.snapshotJson !== null)).toBe(true)
  expect(await db.query.notificationDeliveries.findMany()).toHaveLength(4)
  expect((await db.query.parcelWatches.findFirst())?.lastSnapshotJson).toEqual({
    keep: true,
  })
})
it('can expire historical snapshots independently of event payloads and retains daily reservations forever', async () => {
  const history = await event(
    undefined,
    'lv_change',
    new Date('2026-04-01T00:00:00Z'),
  )
  for (const day of ['2025-01-01', '2026-08-13', '2026-08-14', '2026-09-13']) {
    await db.insert(cuzkApiDailyUsage).values({ day, reserved: 500 })
    await db.insert(cuzkApiRequests).values({
      day,
      endpoint: '/fixture',
      attempt: 1,
      outcome: 'pending',
      startedAt: new Date(day + 'T00:00:00Z'),
    })
  }
  expect(await runRetention({ apply: true, policy, now })).toMatchObject({
    snapshots: 1,
    events: 0,
    apiRequests: 2,
  })
  expect(
    await db.query.watchEvents.findFirst({
      where: eq(watchEvents.id, history.id),
    }),
  ).toMatchObject({ snapshotJson: null, payloadJson: { keep: 'payload' } })
  expect(await db.query.cuzkApiDailyUsage.findMany()).toHaveLength(4)
  expect(
    (await db.query.cuzkApiRequests.findMany()).map((r) => r.day).sort(),
  ).toEqual(['2026-08-14', '2026-09-13'])
})
it('bounds work to a thousand rows and continues on the next run', async () => {
  await db.insert(watchEvents).values(
    Array.from({ length: 1003 }, () => ({
      watchId,
      kind: 'error',
      createdAt: old,
    })),
  )
  expect(
    await runRetention({
      apply: true,
      policy: { RETENTION_ERROR_DAYS: 14 },
      now,
    }),
  ).toMatchObject({ errors: 1000 })
  expect(
    await runRetention({
      apply: true,
      policy: { RETENTION_ERROR_DAYS: 14 },
      now,
    }),
  ).toMatchObject({ errors: 3 })
})
it('skips a concurrent maintenance lock without deleting data', async () => {
  await event()
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('hlidac:retention'))`,
    )
    expect(await runRetention({ apply: true, policy, now })).toMatchObject({
      locked: true,
      events: 0,
    })
  })
  expect(await db.query.watchEvents.findMany()).toHaveLength(1)
})
