import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiControl,
  cuzkApiDailyUsage,
  cuzkApiRequests,
  parcelWatches,
  user,
  watchEvents,
  watchLinks,
} from '../../src/db/schema'
import {
  linkWatches,
  readWatchLinks,
  unlinkWatches,
} from '../../src/lib/watches/links'
import { exportAccount } from '../../src/lib/account-export'
import { pollWatchById } from '../../src/cron/jobs/poll-parcels'
import { parcelUnavailable } from '../../src/lib/cuzk/availability'
import { CuzkHttpError, CuzkUnavailableError } from '../../src/lib/cuzk/policy'

let status = 200,
  body = ''
const server = createServer((_request, response) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(body)
})
let a: string, b: string, foreign: string, building: string
const now = new Date('2026-09-14T08:00:00Z')
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No fixture port')
  process.env.CUZK_API_BASE_URL = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.delete(user)
  await db.delete(cuzkApiControl)
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  status = 200
  body = JSON.stringify({
    data: { id: 1, kmenoveCisloParcely: 1, rizeniPlomby: [], vymera: 100 },
  })
  await db.insert(user).values([
    { id: 'links-owner', name: 'Owner', email: 'links@example.test' },
    { id: 'links-other', name: 'Other', email: 'otherlinks@example.test' },
  ])
  const rows = await db
    .insert(parcelWatches)
    .values([
      {
        userId: 'links-owner',
        isknId: '1',
        label: 'Old parcel',
        pollIntervalMinutes: 1440,
      },
      {
        userId: 'links-owner',
        isknId: '2',
        label: 'New parcel',
        enabled: false,
      },
      { userId: 'links-other', isknId: '3', label: 'Foreign SECRET' },
      {
        userId: 'links-owner',
        isknId: '4',
        label: 'Building',
        objectType: 'stavba',
      },
    ])
    .returning()
  ;[a, b, foreign, building] = rows.map((w) => w.id)
})
afterAll(async () => {
  await db.delete(user)
  await db.delete(cuzkApiControl)
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  )
  await closeDb()
})
it('keeps both histories and schedules when linking, supports split/merge directions and idempotent concurrent writes', async () => {
  await db.insert(watchEvents).values([
    { watchId: a, kind: 'error', payloadJson: { keep: 1 } },
    { watchId: b, kind: 'error', payloadJson: { keep: 2 } },
  ])
  await Promise.all(
    Array.from({ length: 5 }, () =>
      linkWatches('links-owner', {
        fromWatchId: a,
        toWatchId: b,
        note: 'User checked',
      }),
    ),
  )
  expect(await db.query.watchLinks.findMany()).toHaveLength(1)
  expect((await readWatchLinks('links-owner', a)).links).toMatchObject([
    { watchId: b, direction: 'outgoing' },
  ])
  expect((await readWatchLinks('links-owner', b)).links).toMatchObject([
    { watchId: a, direction: 'incoming' },
  ])
  const exported = await exportAccount('links-owner')
  expect(exported.manualLinks).toEqual([
    { fromWatchId: a, toWatchId: b, note: 'User checked' },
  ])
  expect(await db.query.watchEvents.findMany()).toHaveLength(2)
  expect(
    (await db.query.parcelWatches.findFirst({ where: eq(parcelWatches.id, b) }))
      ?.enabled,
  ).toBe(false)
  const [link] = await db.query.watchLinks.findMany()
  await unlinkWatches('links-other', link.id)
  expect(await db.query.watchLinks.findMany()).toHaveLength(1)
  await unlinkWatches('links-owner', link.id)
  expect(await db.query.watchLinks.findMany()).toHaveLength(0)
  expect(await db.query.watchEvents.findMany()).toHaveLength(2)
})
it('rejects foreign, nonparcel and self links; database constraints also enforce matching owners', async () => {
  for (const toWatchId of [a, foreign, building])
    await expect(
      linkWatches('links-owner', { fromWatchId: a, toWatchId }),
    ).rejects.toThrow()
  await expect(readWatchLinks('links-other', a)).rejects.toThrow(
    'Sledování není dostupné',
  )
  expect(JSON.stringify(await readWatchLinks('links-owner', a))).not.toContain(
    'Foreign SECRET',
  )
  await expect(
    db
      .insert(watchLinks)
      .values({ userId: 'links-owner', fromWatchId: a, toWatchId: foreign }),
  ).rejects.toThrow()
})
it('bounds link counts under concurrent inserts and cascades only the relation when a linked watch is deleted', async () => {
  const others = await db
    .insert(parcelWatches)
    .values(
      Array.from({ length: 21 }, (_, i) => ({
        userId: 'links-owner',
        isknId: String(100 + i),
        label: 'Candidate',
      })),
    )
    .returning()
  const result = await Promise.allSettled(
    others.map((w) =>
      linkWatches('links-owner', { fromWatchId: a, toWatchId: w.id }),
    ),
  )
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(20)
  expect((await readWatchLinks('links-owner', a)).links).toHaveLength(20)
  await db
    .insert(watchEvents)
    .values({ watchId: a, kind: 'error', payloadJson: { keep: true } })
  const [link] = await db.query.watchLinks.findMany()
  await db.delete(parcelWatches).where(eq(parcelWatches.id, link.toWatchId))
  expect((await readWatchLinks('links-owner', a)).links).toHaveLength(19)
  expect(await db.query.watchEvents.findMany()).toHaveLength(1)
})
it('records parcel endpoint 404 without losing snapshot/history, uses configured interval and recovers on success', async () => {
  await pollWatchById(a, now)
  const before = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, a),
  })
  status = 404
  await expect(pollWatchById(a, now)).rejects.toThrow('samo nepotvrzuje zánik')
  const missing = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, a),
  })
  expect(missing?.lastSnapshotJson).toEqual(before?.lastSnapshotJson)
  expect(missing?.lastSuccessfulCheckAt).toEqual(before?.lastSuccessfulCheckAt)
  expect(missing?.nextCheckAt).toEqual(new Date(now.getTime() + 86400000))
  expect(
    (await db.query.watchEvents.findMany()).map((e) => e.payloadJson),
  ).toMatchObject([{ availability: 'not_found', httpStatus: 404 }])
  expect(await db.query.notificationDeliveries.findMany()).toHaveLength(0)
  status = 200
  await pollWatchById(a, now)
  expect(
    (await db.query.parcelWatches.findFirst({ where: eq(parcelWatches.id, a) }))
      ?.lastError,
  ).toBeNull()
  expect(await db.query.watchEvents.findMany()).toHaveLength(1)
  expect(await db.query.parcelWatches.findMany()).toHaveLength(4)
})
it('does not interpret transient, empty or malformed replies or missing related endpoints as parcel disappearance', async () => {
  const watch = { objectType: 'parcel', isknId: '1' }
  for (const error of [
    new CuzkHttpError(404, '/api/v1/Rizeni/1'),
    new CuzkHttpError(429, '/api/v1/Parcely/1'),
    new CuzkHttpError(500, '/api/v1/Parcely/1'),
    new CuzkUnavailableError('quota'),
    new Error('Timeout'),
  ])
    expect(parcelUnavailable(error, watch)).toBeNull()
  await pollWatchById(a, now)
  const snapshot = (
    await db.query.parcelWatches.findFirst({ where: eq(parcelWatches.id, a) })
  )?.lastSnapshotJson
  for (const invalid of ['{', '{"data":null}']) {
    body = invalid
    await expect(pollWatchById(a, now)).rejects.toThrow()
    const latest = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, a),
    })
    expect(latest?.lastSnapshotJson).toEqual(snapshot)
    expect(latest?.lastError).not.toContain('HTTP 404')
  }
})
