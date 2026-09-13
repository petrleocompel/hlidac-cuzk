import { createServer } from 'node:http'
import { desc, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  parcelWatches,
  user,
  userNotificationSettings,
  watchEvents,
  watchRizeni,
} from '../../src/db/schema'
import { pollWatchById } from '../../src/cron/jobs/poll-parcels'
import {
  followKnownRizeni,
  stopFollowingRizeni,
} from '../../src/lib/cuzk/rizeni-tracking'
import { normalizeRizeni, parseSnapshot } from '../../src/lib/cuzk/snapshot'

const FOLLOW_DAYS = 14
let watchId: string
let baseUrl: string

const state = {
  plomby: [{ id: 44, typRizeni: 'V', poradoveCislo: 4310, rok: 2026 }] as Array<
    Record<string, unknown>
  >,
  rizeniStatus: 200,
  stav: 'Probíhá řízení' as string | null,
  operace: [{ nazev: 'Přijetí návrhu' }] as Array<
    Record<string, unknown>
  > | null,
}

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url?.startsWith('/api/v1/Rizeni/')) {
    response.statusCode = state.rizeniStatus
    if (state.rizeniStatus !== 200) {
      response.end('{}')
      return
    }
    response.end(
      JSON.stringify({
        data: {
          id: 44,
          typRizeni: 'V',
          poradoveCislo: 4310,
          rok: 2026,
          kodPracoviste: 407,
          stav: state.stav,
          stavUhrady: 'N',
          provedeneOperace: state.operace,
        },
      }),
    )
    return
  }
  response.end(
    JSON.stringify({
      data: { id: 1, vymera: 100, rizeniPlomby: state.plomby },
    }),
  )
})

function at(minutes: number): Date {
  return new Date(Date.parse('2026-01-01T10:00:00Z') + minutes * 60_000)
}

async function rows() {
  return db.select().from(watchRizeni).where(eq(watchRizeni.watchId, watchId))
}

async function events() {
  return db.query.watchEvents.findMany({
    where: eq(watchEvents.watchId, watchId),
    orderBy: [desc(watchEvents.createdAt)],
    with: { deliveries: true },
  })
}

async function snapshot() {
  const row = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, watchId),
  })
  return parseSnapshot(row?.lastSnapshotJson)
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('no fixture port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.CUZK_API_BASE_URL = baseUrl
  process.env.CUZK_RIZENI_FOLLOW_DAYS = String(FOLLOW_DAYS)
})

beforeEach(async () => {
  await db.delete(user)
  state.plomby = [{ id: 44, typRizeni: 'V', poradoveCislo: 4310, rok: 2026 }]
  state.rizeniStatus = 200
  state.stav = 'Probíhá řízení'
  state.operace = [{ nazev: 'Přijetí návrhu' }]
  await db
    .insert(user)
    .values({ id: 'follow-owner', name: 'Owner', email: 'follow@example.test' })
  await db
    .insert(userNotificationSettings)
    .values({ userId: 'follow-owner', slackWebhookUrl: `${baseUrl}/slack` })
  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId: 'follow-owner',
      label: 'Follow test',
      pollIntervalMinutes: 60,
      kuCode: '777552',
      kuName: 'Test',
      parcelNumber: 1,
      isknId: '1',
    })
    .returning()
  watchId = row.id
  // Baseline check: the first sighting of a plomba is not a progress change.
  const first = await pollWatchById(watchId, at(0))
  expect(first.status).toBe('checked')
  expect(first.changes).toEqual([])
})

afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('following a řízení across checks (PostgreSQL)', () => {
  it('tracks a plomba as its own object', async () => {
    const [row] = await rows()
    expect(row).toMatchObject({
      rizeniId: '44',
      source: 'plomba',
      isPlomba: true,
      typRizeni: 'V',
      poradoveCislo: 4310,
      followEndedAt: null,
    })
    expect(row.detailJson).toMatchObject({ stav: 'Probíhá řízení' })
  })

  it('reports a state change on the same řízení id and queues a message', async () => {
    state.stav = 'Vklad povolen, zapsáno'
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes.map((change) => change.kind)).toEqual([
      'rizeni_progress',
    ])
    expect(result.queued).toBe(1)
    const [event] = await events()
    expect(event.kind).toBe('rizeni_progress')
    expect(event.payloadJson).toMatchObject({
      fields: ['stav'],
      followed: false,
      previous: { stav: 'Probíhá řízení' },
      next: { stav: 'Vklad povolen, zapsáno' },
    })
    expect(event.deliveries.at(0)?.message).toContain('Vklad povolen')
  })

  it('reports added operations', async () => {
    state.operace = [
      { nazev: 'Přijetí návrhu' },
      { nazev: 'Vklad proveden', datumProvedeni: '2026-01-01T09:00:00Z' },
    ]
    const result = await pollWatchById(watchId, at(60))
    const change = result.changes.at(0)
    expect(change?.kind === 'rizeni_progress' && change.fields).toEqual([
      'provedeneOperace',
    ])
    expect(
      change?.kind === 'rizeni_progress' &&
        change.addedOperations.map((op) => op.nazev),
    ).toEqual(['Vklad proveden'])
  })

  it('keeps following a detached plomba and reports its result', async () => {
    state.plomby = []
    state.stav = 'Vklad povolen, zapsáno'
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes.map((change) => change.kind)).toEqual([
      'new_rizeni',
      'rizeni_progress',
    ])
    const progress = result.changes.at(1)
    expect(progress?.kind === 'rizeni_progress' && progress.followed).toBe(true)
    const [row] = await rows()
    expect(row.isPlomba).toBe(false)
    expect(row.detachedAt).toEqual(at(60))
    expect(row.followUntil).toEqual(
      new Date(at(60).getTime() + FOLLOW_DAYS * 86_400_000),
    )
    expect(row.followEndedAt).toBeNull()
    // The removal itself must not be presented as an approved vklad.
    const removal = await events()
    expect(
      removal.find((event) => event.kind === 'new_rizeni')?.deliveries.at(0)
        ?.message,
    ).toContain('nepotvrzuje schválení vkladu')
  })

  it('ends the follow-up when ČÚZK stops publishing the řízení', async () => {
    state.plomby = []
    await pollWatchById(watchId, at(60))
    state.rizeniStatus = 404
    const result = await pollWatchById(watchId, at(120))
    expect(result.changes).toEqual([])
    const [row] = await rows()
    expect(row.followEndedReason).toBe('unavailable')
    expect(row.followEndedAt).toEqual(at(120))
    expect(row.detailJson).toMatchObject({ stav: 'Probíhá řízení' })
  })

  it('stops querying after the follow window and keeps the history', async () => {
    state.plomby = []
    await pollWatchById(watchId, at(60))
    const afterWindow = new Date(
      at(60).getTime() + (FOLLOW_DAYS + 1) * 86_400_000,
    )
    state.stav = 'Vklad povolen, zapsáno'
    const result = await pollWatchById(watchId, afterWindow)
    expect(result.changes).toEqual([])
    const [row] = await rows()
    expect(row.followEndedReason).toBe('window')
    expect(row.detailJson).toMatchObject({ stav: 'Probíhá řízení' })
    expect((await events()).some((event) => event.kind === 'new_rizeni')).toBe(
      true,
    )
  })

  it('survives a failing detail request without emptying known values', async () => {
    state.rizeniStatus = 500
    const result = await pollWatchById(watchId, at(60))
    expect(result.changes).toEqual([])
    const stored = await snapshot()
    expect(stored?.rizeni.at(0)).toMatchObject({
      stav: 'Probíhá řízení',
      stavUhrady: 'N',
      detailAvailable: false,
    })
    expect(stored?.rizeni.at(0)?.provedeneOperace).toHaveLength(1)
    const [row] = await rows()
    expect(row.lastError).toMatch(/poslední známé/)
    expect(row.isPlomba).toBe(true)
  })
})

describe('manually followed řízení (PostgreSQL)', () => {
  const known = () =>
    normalizeRizeni(
      { id: 99, typRizeni: 'V', poradoveCislo: 1, rok: 2026, stav: 'Podáno' },
      at(0),
    )

  it('adds a known řízení and keeps following it without a deadline', async () => {
    const result = await followKnownRizeni(
      watchId,
      'follow-owner',
      known(),
      at(10),
    )
    expect(result.alreadyTracked).toBe(false)
    const row = (await rows()).find((item) => item.rizeniId === '99')
    expect(row).toMatchObject({
      source: 'manual',
      isPlomba: false,
      followUntil: null,
      followEndedAt: null,
      poradoveCislo: 1,
    })
    // A repeated request is not an error and does not duplicate the row.
    expect(
      (await followKnownRizeni(watchId, 'follow-owner', known(), at(20)))
        .alreadyTracked,
    ).toBe(true)
    expect(
      (await rows()).filter((item) => item.rizeniId === '99'),
    ).toHaveLength(1)
  })

  it('refuses a watch owned by someone else', async () => {
    await db
      .insert(user)
      .values({ id: 'stranger', name: 'Stranger', email: 'x@example.test' })
    await expect(
      followKnownRizeni(watchId, 'stranger', known(), at(10)),
    ).rejects.toThrow('not_found')
    expect((await rows()).some((item) => item.rizeniId === '99')).toBe(false)
  })

  it('stops the follow-up on request and keeps the stored detail', async () => {
    await followKnownRizeni(watchId, 'follow-owner', known(), at(10))
    const row = (await rows()).find((item) => item.rizeniId === '99')!
    await expect(
      stopFollowingRizeni(row.id, 'stranger', at(20)),
    ).rejects.toThrow(/nelze ukončit/)
    await stopFollowingRizeni(row.id, 'follow-owner', at(20))
    const stopped = (await rows()).find((item) => item.rizeniId === '99')
    expect(stopped).toMatchObject({
      followEndedReason: 'user',
      followEndedAt: at(20),
    })
    expect(stopped?.detailJson).toMatchObject({ stav: 'Podáno' })
    // A plomba cannot be unfollowed: it is part of the parcel snapshot.
    const plomba = (await rows()).find((item) => item.rizeniId === '44')!
    await expect(
      stopFollowingRizeni(plomba.id, 'follow-owner', at(30)),
    ).rejects.toThrow(/nelze ukončit/)
  })

  it('does not query a stopped follow again', async () => {
    await followKnownRizeni(watchId, 'follow-owner', known(), at(10))
    const row = (await rows()).find((item) => item.rizeniId === '99')!
    await stopFollowingRizeni(row.id, 'follow-owner', at(20))
    state.stav = 'Vklad povolen, zapsáno'
    const result = await pollWatchById(watchId, at(60))
    // Only the still-attached plomba 44 reports progress.
    expect(
      result.changes.every(
        (change) =>
          change.kind === 'rizeni_progress' && change.next.id === '44',
      ),
    ).toBe(true)
  })
})
