import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  parcelWatches,
  user,
  userNotificationSettings,
  watchEvents,
} from '../../src/db/schema'
import { pollWatchById } from '../../src/cron/jobs/poll-parcels'
import { buildEventExport, readEventPage } from '../../src/lib/watch-history'

let watchId: string
let baseUrl: string
const created = new Date('2026-01-01T09:00:00Z')

const state = {
  vymera: 976,
  ochrany: ['zemědělský půdní fond'] as string[] | null,
  bpej: [
    { kod: 52011, vymera: 500 },
    { kod: 52014, vymera: 476 },
  ] as Array<{ kod: number; vymera: number }> | null,
  plomby: [] as Array<Record<string, unknown>>,
}

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url?.startsWith('/api/v1/Rizeni/')) {
    response.end(
      JSON.stringify({
        data: { id: 44, typRizeni: 'V', poradoveCislo: 1, rok: 2026 },
      }),
    )
    return
  }
  response.end(
    JSON.stringify({
      aktualnostDatK: '2026-01-01T23:00:00Z',
      data: {
        id: 1,
        vymera: state.vymera,
        zpusobyOchrany: state.ochrany,
        bpej: state.bpej,
        rizeniPlomby: state.plomby,
      },
    }),
  )
})

function at(minutes: number): Date {
  return new Date(created.getTime() + minutes * 60_000)
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('no fixture port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.CUZK_API_BASE_URL = baseUrl
})

beforeEach(async () => {
  await db.delete(user)
  state.vymera = 976
  state.ochrany = ['zemědělský půdní fond']
  state.bpej = [
    { kod: 52011, vymera: 500 },
    { kod: 52014, vymera: 476 },
  ]
  state.plomby = []
  await db.insert(user).values({
    id: 'history-owner',
    name: 'Owner',
    email: 'history@example.test',
  })
  await db
    .insert(userNotificationSettings)
    .values({ userId: 'history-owner', slackWebhookUrl: `${baseUrl}/slack` })
  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId: 'history-owner',
      label: 'History test',
      pollIntervalMinutes: 60,
      kuCode: '777552',
      kuName: 'Test',
      parcelNumber: 1,
      isknId: '1',
      createdAt: created,
    })
    .returning()
  watchId = row.id
  await pollWatchById(watchId, at(0))
})

afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('watch history (PostgreSQL)', () => {
  it('stores both values and the snapshot behind a change', async () => {
    state.vymera = 980
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes).toHaveLength(1)
    const page = await readEventPage(watchId, {})
    expect(page.total).toBe(1)
    const event = page.events[0]
    expect(event.kind).toBe('parcel_attrs')
    expect(event.payloadJson).toMatchObject({
      values: [{ field: 'vymera', previous: 976, next: 980 }],
    })
    expect(event.dataFetchedAt).toBe(at(60).toISOString())
    // The ČÚZK actuality is kept exactly as the API reported it.
    expect(event.dataAsOf).toBe('2026-01-01T23:00:00Z')
    const [stored] = await db
      .select({ snapshot: watchEvents.snapshotJson })
      .from(watchEvents)
      .where(eq(watchEvents.watchId, watchId))
    expect(stored.snapshot).toMatchObject({ parcel: { vymera: 980 } })
  })

  it('does not create an event when BPEJ is only reordered', async () => {
    state.bpej = [
      { kod: 52014, vymera: 476 },
      { kod: 52011, vymera: 500 },
    ]
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes).toEqual([])
    expect((await readEventPage(watchId, {})).total).toBe(0)
  })

  it('does not report a missing list as a removal', async () => {
    state.ochrany = null
    state.bpej = null
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes).toEqual([])
  })

  it('pages past the newest events and filters by kind', async () => {
    for (let i = 1; i <= 4; i++) {
      state.vymera = 976 + i
      await pollWatchById(watchId, at(60 * i))
    }
    state.plomby = [{ id: 44, typRizeni: 'V', poradoveCislo: 1, rok: 2026 }]
    await pollWatchById(watchId, at(600))

    const first = await readEventPage(watchId, { limit: 2 })
    expect(first.total).toBe(5)
    expect(first.events.map((event) => event.kind)).toEqual([
      'new_rizeni',
      'parcel_attrs',
    ])
    const older = await readEventPage(watchId, { limit: 2, offset: 4 })
    expect(older.events).toHaveLength(1)
    expect(older.events[0].payloadJson).toMatchObject({
      values: [{ previous: 976, next: 977 }],
    })
    const onlyAttrs = await readEventPage(watchId, { kinds: ['parcel_attrs'] })
    expect(onlyAttrs.total).toBe(4)
    expect(
      onlyAttrs.events.every((event) => event.kind === 'parcel_attrs'),
    ).toBe(true)
  })

  it('exports CSV and JSON with acquisition times and the history start', async () => {
    state.vymera = 980
    await pollWatchById(watchId, at(60))
    const watch = { id: watchId, label: 'History test', createdAt: created }

    const csv = await buildEventExport(watch, 'csv')
    expect(csv.filename).toMatch(
      /^hlidac-cuzk-historie-\d{4}-\d{2}-\d{2}\.csv$/,
    )
    expect(csv.truncated).toBe(false)
    const [header, row] = csv.content.split('\r\n')
    expect(header).toBe(
      '"cas_zachyceni","typ","popis","data_nactena","data_cuzk_k"',
    )
    expect(row).toContain('parcel_attrs')
    expect(row).toContain('976 m² → 980 m²')
    expect(row).toContain('2026-01-01T23:00:00Z')

    const json = await buildEventExport(watch, 'json')
    const parsed = JSON.parse(json.content)
    expect(parsed.historyFrom).toBe(created.toISOString())
    expect(parsed.total).toBe(1)
    expect(parsed.events[0]).toMatchObject({
      kind: 'parcel_attrs',
      dataAsOf: '2026-01-01T23:00:00Z',
    })
  })
})

it('finds an older linked event beyond the first page and scopes it to the requested watch', async () => {
  const [old] = await db
    .insert(watchEvents)
    .values({ watchId, kind: 'lv_change', payloadJson: {}, createdAt: created })
    .returning()
  await db.insert(watchEvents).values(
    Array.from({ length: 60 }, (_, i) => ({
      watchId,
      kind: 'parcel_attrs',
      payloadJson: {},
      createdAt: at(i + 1),
    })),
  )
  expect(
    (await readEventPage(watchId, {})).events.some(
      (event) => event.id === old.id,
    ),
  ).toBe(false)
  expect(
    (await readEventPage(watchId, { eventId: old.id })).events.map(
      (event) => event.id,
    ),
  ).toEqual([old.id])
  expect(
    (await readEventPage(crypto.randomUUID(), { eventId: old.id })).events,
  ).toEqual([])
})
