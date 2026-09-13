import { eq, inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  parcelWatches,
  user,
  watchEvents,
  notificationDeliveries,
} from '../../src/db/schema'
import {
  changeWatchBatch,
  saveWatchOrganization,
} from '../../src/server/organization.server'

let own: string[], other: string
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
})
beforeEach(async () => {
  await db.delete(user)
  await db.insert(user).values([
    {
      id: 'organization-owner',
      name: 'Owner',
      email: 'organization@example.test',
    },
    { id: 'organization-other', name: 'Other', email: 'other@example.test' },
  ])
  const rows = await db
    .insert(parcelWatches)
    .values([
      {
        userId: 'organization-owner',
        isknId: '1',
        label: 'Own one',
        pollIntervalMinutes: 1440,
        nextCheckAt: new Date('2026-10-01T00:00:00Z'),
        lastAttemptAt: new Date('2026-09-01T00:00:00Z'),
      },
      {
        userId: 'organization-owner',
        isknId: '2',
        label: 'Own two',
        pollIntervalMinutes: 1440,
        nextCheckAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        userId: 'organization-other',
        isknId: '1',
        label: 'Other one',
        notes: 'private other',
        tags: ['Other'],
      },
    ])
    .returning()
  own = rows.filter((r) => r.userId === 'organization-owner').map((r) => r.id)
  other = rows.find((r) => r.userId === 'organization-other')!.id
})
afterAll(closeDb)
it('keeps normalized metadata private to one subscription', async () => {
  await saveWatchOrganization('organization-owner', {
    id: own[0],
    label: 'My house',
    notes: 'private text',
    tags: [' Dům ', 'dum', 'Rodina'],
  })
  expect(
    await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, own[0]),
    }),
  ).toMatchObject({
    notes: 'private text',
    tags: ['Dům', 'Rodina'],
    label: 'My house',
  })
  await expect(
    saveWatchOrganization('organization-owner', {
      id: other,
      label: 'attack',
      notes: 'attack',
      tags: [],
    }),
  ).rejects.toThrow('dostupné')
  expect(
    await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, other),
    }),
  ).toMatchObject({
    notes: 'private other',
    tags: ['Other'],
    label: 'Other one',
  })
})
it('rejects a batch containing another owner or a missing object atomically', async () => {
  for (const invalid of [other, 'f779d7fa-1111-4111-8111-111111111111'])
    await expect(
      changeWatchBatch('organization-owner', {
        ids: [...own, invalid],
        enabled: false,
      }),
    ).rejects.toThrow('Žádná změna')
  expect(
    (await db.query.parcelWatches.findMany()).every((w) => w.enabled),
  ).toBe(true)
})
it('pauses only selected watches and preserves captured events and their queued deliveries', async () => {
  const [event] = await db
    .insert(watchEvents)
    .values({ watchId: own[0], kind: 'lv_change', payloadJson: {} })
    .returning()
  await db
    .insert(notificationDeliveries)
    .values({
      eventId: event.id,
      channel: 'gotify',
      title: 'fixture',
      message: 'fixture',
    })
  expect(
    await changeWatchBatch('organization-owner', {
      ids: [own[0], own[0]],
      enabled: false,
    }),
  ).toEqual({ updated: 1 })
  expect(
    (
      await db.query.parcelWatches.findFirst({
        where: eq(parcelWatches.id, own[0]),
      })
    )?.enabled,
  ).toBe(false)
  expect(
    (
      await db.query.parcelWatches.findFirst({
        where: eq(parcelWatches.id, own[1]),
      })
    )?.enabled,
  ).toBe(true)
  expect(
    await db.query.notificationDeliveries.findFirst({
      where: eq(notificationDeliveries.eventId, event.id),
    }),
  ).toMatchObject({ status: 'pending', attemptCount: 0 })
})
it('reschedules changed intervals and resumes paused watches without overriding active due dates', async () => {
  await changeWatchBatch('organization-owner', {
    ids: own,
    pollIntervalMinutes: 60,
  })
  const first = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, own[0]),
  })
  expect(first?.nextCheckAt?.toISOString()).toBe('2026-09-01T01:00:00.000Z')
  await changeWatchBatch('organization-owner', {
    ids: [own[1]],
    enabled: false,
  })
  const now = Date.now()
  await changeWatchBatch('organization-owner', { ids: own, enabled: true })
  expect(
    (
      await db.query.parcelWatches.findFirst({
        where: eq(parcelWatches.id, own[0]),
      })
    )?.nextCheckAt,
  ).toEqual(first?.nextCheckAt)
  const resumed = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, own[1]),
  })
  expect(resumed!.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(now - 1000)
})
it('serializes overlapping batches without losing unrelated fields', async () => {
  await Promise.all([
    changeWatchBatch('organization-owner', { ids: own, enabled: false }),
    changeWatchBatch('organization-owner', {
      ids: [...own].reverse(),
      pollIntervalMinutes: 30,
    }),
  ])
  const rows = await db.query.parcelWatches.findMany({
    where: inArray(parcelWatches.id, own),
  })
  expect(
    rows.every(
      (w) =>
        !w.enabled &&
        w.pollIntervalMinutes === 30 &&
        w.notes === '' &&
        w.tags.length === 0,
    ),
  ).toBe(true)
})
