import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiControl,
  parcelWatches,
  user,
  userNotificationSettings,
  watchEvents,
} from '../../src/db/schema'
import { readPortfolio } from '../../src/lib/portfolio'
import { buildParcelSnapshot } from '../../src/lib/cuzk/snapshot'
import { pollDueWatches } from '../../src/cron/jobs/poll-parcels'
import { encryptNotificationSecret } from '../../src/lib/notifications/secrets'

let calls = 0
let area = 100
const initial = new Date('2026-01-01T00:00:00Z')
const server = createServer((req, res) => {
  calls++
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      data: {
        id: Number(req.url?.split('/').at(-1)),
        typParcely: 'PKN',
        katastralniUzemi: { kod: 777552, nazev: 'Fixture' },
        kmenoveCisloParcely: 1,
        vymera: area,
        lv: {
          id: 10,
          cislo: 12,
          katastralniUzemi: { kod: 777552, nazev: 'Fixture' },
        },
        rizeniPlomby: [],
      },
    }),
  )
})
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  vi.stubEnv('CUZK_API_BASE_URL', `http://127.0.0.1:${address.port}`)
})
beforeEach(async () => {
  await db.delete(cuzkApiControl)
  await db.delete(user)
  await db.insert(user).values([
    { id: 'portfolio-owner', name: 'Owner', email: 'portfolio@example.test' },
    {
      id: 'portfolio-other',
      name: 'Other',
      email: 'portfolio-other@example.test',
    },
  ])
  calls = 0
  area = 100
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
async function watch(
  isknId: string,
  lv: number | null = 12,
  kuCode = '777552',
  owner = 'portfolio-owner',
) {
  const snapshot = await buildParcelSnapshot(isknId, initial)
  // Keep the LV id of the fixture: only the number differs between groups, so a
  // later check does not report an accidental LV change.
  snapshot.parcel.lv =
    lv === null
      ? null
      : { id: '10', cislo: lv, kuKod: Number(kuCode), kuNazev: 'Fixture' }
  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId: owner,
      isknId,
      label: `${owner} private ${isknId}`,
      kuCode,
      kuName: 'Fixture',
      parcelNumber: Number(isknId),
      lastSnapshotJson: snapshot,
      lastCheckedAt: initial,
      pollIntervalMinutes: 1440,
      nextCheckAt: initial,
    })
    .returning()
  return row
}
async function event(watchId: string, index = 0) {
  const [row] = await db
    .insert(watchEvents)
    .values({
      watchId,
      kind: 'parcel_attrs',
      payloadJson: { kind: 'parcel_attrs', fields: ['vymera'] },
      createdAt: new Date(initial.getTime() + index * 1000),
    })
    .returning()
  return row
}
it('groups only owned watched objects by both KÚ and LV, without extra API calls', async () => {
  await watch('1')
  await watch('2')
  await watch('3', 12, '888888')
  await watch('4', null)
  const foreign = await watch('1', 12, '777552', 'portfolio-other')
  await event(foreign.id)
  calls = 0
  const groups = await readPortfolio('portfolio-owner')
  expect(groups).toHaveLength(3)
  expect(
    groups.find((group) => group.key === '777552:12')?.watches,
  ).toHaveLength(2)
  expect(
    groups.find((group) => group.key === '888888:12')?.watches,
  ).toHaveLength(1)
  expect(groups.find((group) => group.lvNumber === null)?.watches).toHaveLength(
    1,
  )
  expect(JSON.stringify(groups)).not.toContain('portfolio-other')
  expect(groups.flatMap((group) => group.events)).toHaveLength(0)
  expect(calls).toBe(0)
})
it('moves a watched object to its latest LV while keeping links to its history', async () => {
  const row = await watch('1')
  const change = await event(row.id)
  const snapshot = await buildParcelSnapshot('1', initial)
  snapshot.parcel.lv!.cislo = 99
  await db
    .update(parcelWatches)
    .set({ lastSnapshotJson: snapshot })
    .where(eq(parcelWatches.id, row.id))
  const groups = await readPortfolio('portfolio-owner')
  expect(groups.map((group) => group.lvNumber)).toEqual([99])
  expect(groups[0].events[0]).toMatchObject({
    id: change.id,
    watchId: row.id,
    label: row.label,
  })
})
it('bounds each LV feed independently and includes paused watches', async () => {
  const busy = await watch('1'),
    quiet = await watch('2', 99)
  await db
    .update(parcelWatches)
    .set({ enabled: false })
    .where(eq(parcelWatches.id, quiet.id))
  for (let i = 0; i < 15; i++) await event(busy.id, 100 + i)
  await event(quiet.id)
  const groups = await readPortfolio('portfolio-owner')
  expect(groups.find((group) => group.lvNumber === 12)?.events).toHaveLength(10)
  expect(groups.find((group) => group.lvNumber === 99)?.events).toHaveLength(1)
  expect(
    groups.find((group) => group.lvNumber === 99)?.watches[0].enabled,
  ).toBe(false)
})
it('returns an empty portfolio without inferring unwatched properties', async () => {
  expect(await readPortfolio('portfolio-owner')).toEqual([])
  expect(calls).toBe(0)
})
it('shares parcel data during a polling cycle while keeping private event histories and channel rules', async () => {
  const first = await watch('1'),
    second = await watch('1', 12, '777552', 'portfolio-other')
  await db.insert(userNotificationSettings).values(
    ['portfolio-owner', 'portfolio-other'].map((id) => ({
      userId: id,
      gotifyUrl: 'http://127.0.0.1:1',
      gotifyToken: encryptNotificationSecret('fixture', id, 'gotifyToken'),
    })),
  )
  await db
    .update(parcelWatches)
    .set({ notifyChannels: [] })
    .where(eq(parcelWatches.id, second.id))
  area = 101
  calls = 0
  expect(await pollDueWatches(new Date('2026-01-02T00:00:00Z'))).toMatchObject({
    checked: 2,
    queued: 1,
    errors: 0,
  })
  expect(calls).toBe(1)
  const histories = await db.query.watchEvents.findMany()
  expect(histories.map((e) => e.watchId).sort()).toEqual(
    [first.id, second.id].sort(),
  )
  const messages = await db.query.notificationDeliveries.findMany()
  expect(messages).toHaveLength(1)
  expect(messages[0].title).toContain(first.label)
  expect(messages[0].title).not.toContain(second.label)
  const foreign = await readPortfolio('portfolio-other')
  expect(foreign[0].events).toHaveLength(1)
  expect(foreign[0].events[0].watchId).toBe(second.id)
  // The next cycle fetches fresh data; manual checks have their own cache too.
  area = 102
  calls = 0
  expect((await pollDueWatches(new Date('2026-01-03T00:00:00Z'))).checked).toBe(
    2,
  )
  expect(calls).toBe(1)
  expect(await db.query.watchEvents.findMany()).toHaveLength(4)
})
