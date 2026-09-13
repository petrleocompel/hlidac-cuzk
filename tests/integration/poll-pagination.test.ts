import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  user,
  parcelWatches,
  cuzkApiControl,
  cuzkApiDailyUsage,
  cuzkApiRequests,
} from '../../src/db/schema'
import { readDueWatchPage } from '../../src/lib/cuzk/due-watches'
import type { DueCursor } from '../../src/lib/cuzk/due-watches'
import { pollDueWatches } from '../../src/cron/jobs/poll-parcels'

let calls: string[] = []
const server = createServer((req, res) => {
  calls.push(req.url!)
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      data: {
        id: 1,
        vymera: 100,
        typStavby: { kod: 1, nazev: 'Fixture' },
        rizeniPlomby: [],
      },
    }),
  )
})
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture port')
  vi.stubEnv('CUZK_API_BASE_URL', `http://127.0.0.1:${address.port}`)
})
beforeEach(async () => {
  await db.delete(user)
  await db.delete(cuzkApiControl)
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  calls = []
  await db
    .insert(user)
    .values({ id: 'page-owner', name: 'Fixture', email: 'page@example.test' })
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await db.delete(cuzkApiControl)
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
it('pages null and equal due timestamps without repeats, excluding disabled and future legacy rows', async () => {
  const now = new Date()
  const records = await db
    .insert(parcelWatches)
    .values(
      Array.from({ length: 235 }, (_, i) => ({
        userId: 'page-owner',
        isknId: String(i + 1),
        label: 'Fixture',
        nextCheckAt: i < 120 ? null : new Date('2026-01-01T00:00:00Z'),
      })),
    )
    .returning({ id: parcelWatches.id })
  await db.insert(parcelWatches).values([
    { userId: 'page-owner', isknId: '9991', label: 'disabled', enabled: false },
    {
      userId: 'page-owner',
      isknId: '9992',
      label: 'future',
      nextCheckAt: new Date(now.getTime() + 3600000),
    },
    {
      userId: 'page-owner',
      isknId: '9993',
      label: 'legacy future',
      lastCheckedAt: new Date(now.getTime() + 3600000),
    },
  ])
  let cursor: DueCursor | undefined
  const seen: string[] = []
  const sizes: number[] = []
  for (;;) {
    const page = await readDueWatchPage(now, cursor)
    if (!page.length) break
    sizes.push(page.length)
    seen.push(...page.map((w) => w.id))
    cursor = page.at(-1)!
  }
  expect(sizes).toEqual([100, 100, 35])
  expect(new Set(seen).size).toBe(235)
  expect(seen.sort()).toEqual(records.map((r) => r.id).sort())
  expect(calls).toHaveLength(0)
})
it('shares fetched objects across owners and page boundaries, separating register types and starting fresh next cycle', async () => {
  const owners = Array.from({ length: 102 }, (_, i) => ({
    id: `page-${i}`,
    name: 'Fixture',
    email: `page-${i}@example.test`,
  }))
  await db.insert(user).values(owners)
  await db.insert(parcelWatches).values(
    owners.map((owner, i) => ({
      userId: owner.id,
      isknId: '1',
      objectType: i === 101 ? ('jednotka' as const) : ('stavba' as const),
      label: `private ${i}`,
    })),
  )
  const now = new Date()
  expect(await pollDueWatches(now)).toEqual({
    checked: 102,
    queued: 0,
    errors: 0,
    skipped: 0,
  })
  expect(calls.sort()).toEqual(['/api/v1/Jednotky/1', '/api/v1/Stavby/1'])
  expect(
    (await db.query.parcelWatches.findMany()).every(
      (w) => w.lastSuccessfulCheckAt?.getTime() === now.getTime(),
    ),
  ).toBe(true)
  expect(
    (await db.query.parcelWatches.findMany()).every((w) =>
      w.label.startsWith('private '),
    ),
  ).toBe(true)
  const tomorrow = new Date(now.getTime() + 86400000)
  expect((await pollDueWatches(tomorrow)).checked).toBe(102)
  expect(calls).toHaveLength(4)
})
it('counts unvisited pages when the API budget pauses the cycle', async () => {
  await db.insert(parcelWatches).values(
    Array.from({ length: 105 }, (_, i) => ({
      userId: 'page-owner',
      isknId: String(i + 1),
      label: 'Fixture',
    })),
  )
  const day = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Europe/Prague',
  })
  await db.insert(cuzkApiDailyUsage).values({ day, reserved: 500 })
  expect(await pollDueWatches()).toEqual({
    checked: 1,
    errors: 1,
    queued: 0,
    skipped: 104,
  })
  expect(calls).toHaveLength(0)
  expect(
    (
      await db.query.cuzkApiDailyUsage.findFirst({
        where: eq(cuzkApiDailyUsage.day, day),
      })
    )?.reserved,
  ).toBe(500)
})
