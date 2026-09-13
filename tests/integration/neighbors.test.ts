import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiControl,
  cuzkApiRequests,
  parcelWatches,
  user,
} from '../../src/db/schema'
import {
  addSelectedNeighbors,
  previewNeighbors,
} from '../../src/lib/cuzk/neighbors'

let watchId: string
let calls = 0
let status = 200
const parcel = (id: number) => ({
  id,
  typParcely: 'PKN',
  druhCislovaniParcely: 2,
  kmenoveCisloParcely: id,
  katastralniUzemi: { kod: 777552, nazev: 'Fixture' },
})
let response: Record<string, unknown> = {}
const paths: string[] = []
const server = createServer((request, res) => {
  calls++
  paths.push(request.url ?? '')
  res.statusCode = status
  if (status === 429) res.setHeader('Retry-After', '60')
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(response))
})
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('missing fixture port')
  vi.stubEnv('CUZK_API_BASE_URL', `http://127.0.0.1:${address.port}`)
})
beforeEach(async () => {
  delete process.env.MAX_WATCHES_PER_USER
  await db.delete(cuzkApiControl)
  await db.delete(user)
  await db.insert(user).values([
    { id: 'neighbors-owner', name: 'Owner', email: 'neighbors@example.test' },
    {
      id: 'neighbors-other',
      name: 'Other',
      email: 'neighbors-other@example.test',
    },
  ])
  const [watch] = await db
    .insert(parcelWatches)
    .values({
      userId: 'neighbors-owner',
      kuCode: '777552',
      kuName: 'Fixture',
      parcelNumber: 1,
      isknId: '1',
      label: 'Parent',
    })
    .returning()
  watchId = watch.id
  response = {
    data: [parcel(2), parcel(3)],
    aktualnostDatK: '2026-09-13T00:00:00Z',
  }
  status = 200
  calls = 0
  paths.length = 0
})
afterAll(async () => {
  vi.unstubAllEnvs()
  delete process.env.MAX_WATCHES_PER_USER
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('bounded neighbor subscriptions', () => {
  it('checks ownership before preview or confirmation consumes an API call', async () => {
    await expect(previewNeighbors('neighbors-other', watchId)).rejects.toThrow(
      'nebylo nalezeno',
    )
    await expect(
      addSelectedNeighbors('neighbors-other', { watchId, ids: ['2'] }),
    ).rejects.toThrow('nebylo nalezeno')
    expect(calls).toBe(0)
  })
  it('previews with one accounted request, creates only selected definitions and does not recurse', async () => {
    const preview = await previewNeighbors('neighbors-owner', watchId)
    expect(preview).toMatchObject({
      total: 2,
      availableSlots: 99,
      selectionLimit: 20,
      dailyLimit: 500,
    })
    expect(calls).toBe(1)
    expect(await db.query.parcelWatches.findMany()).toHaveLength(1)
    expect(
      await addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2'] }),
    ).toEqual({ created: 1, skipped: 0 })
    expect(paths).toEqual([
      '/api/v1/Parcely/SousedniParcely/1',
      '/api/v1/Parcely/SousedniParcely/1',
    ])
    const created = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.isknId, '2'),
    })
    expect(created).toMatchObject({
      kuCode: '777552',
      kuName: 'Fixture',
      parcelNumber: 2,
      pollIntervalMinutes: 1440,
      lastSnapshotJson: null,
    })
    const metrics = await db.query.cuzkApiRequests.findMany({
      where: eq(
        cuzkApiRequests.endpoint,
        '/api/v1/Parcely/SousedniParcely/:id',
      ),
    })
    expect(metrics.length).toBeGreaterThanOrEqual(2)
  })
  it('skips already watched neighbors and serializes concurrent confirmations', async () => {
    const results = await Promise.all([
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2', '3'] }),
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2', '3'] }),
    ])
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(2)
    expect(await db.query.parcelWatches.findMany()).toHaveLength(3)
    expect(
      (await previewNeighbors('neighbors-owner', watchId)).parcels.every(
        (p) => p.alreadyWatchedId,
      ),
    ).toBe(true)
  })
  it('rejects a changed or forged selection without storing a partial batch', async () => {
    await previewNeighbors('neighbors-owner', watchId)
    response = { data: [parcel(2)] }
    await expect(
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2', '3'] }),
    ).rejects.toThrow('Obnovte náhled')
    expect(await db.query.parcelWatches.findMany()).toHaveLength(1)
  })
  it('enforces the per-account capacity atomically and rejects oversized input before HTTP', async () => {
    process.env.MAX_WATCHES_PER_USER = '2'
    await expect(
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2', '3'] }),
    ).rejects.toThrow('limit sledování')
    expect(await db.query.parcelWatches.findMany()).toHaveLength(1)
    calls = 0
    await expect(
      addSelectedNeighbors('neighbors-owner', {
        watchId,
        ids: Array.from({ length: 21 }, (_, i) => String(i + 2)),
      }),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
  it('treats absent data as unknown coverage and reports unsupported definitions', async () => {
    response = { data: null }
    expect(await previewNeighbors('neighbors-owner', watchId)).toMatchObject({
      parcels: [],
      total: 0,
    })
    response = {
      data: [
        parcel(1),
        parcel(2),
        parcel(2),
        { ...parcel(3), typParcely: 'PZE' },
        { id: 4, typParcely: 'PKN' },
      ],
    }
    expect(await previewNeighbors('neighbors-owner', watchId)).toMatchObject({
      total: 1,
      unsupported: 2,
    })
  })
  it('bounds the preview and never accepts a hidden row', async () => {
    response = { data: Array.from({ length: 101 }, (_, i) => parcel(i + 2)) }
    const preview = await previewNeighbors('neighbors-owner', watchId)
    expect(preview).toMatchObject({ total: 101, truncated: true })
    expect(preview.parcels).toHaveLength(100)
    await expect(
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['102'] }),
    ).rejects.toThrow('Obnovte náhled')
  })
  it('honors the shared rate-limit pause without creating watches', async () => {
    status = 429
    await expect(
      addSelectedNeighbors('neighbors-owner', { watchId, ids: ['2'] }),
    ).rejects.toThrow()
    expect(calls).toBe(1)
    await expect(previewNeighbors('neighbors-owner', watchId)).rejects.toThrow()
    expect(calls).toBe(1)
    expect(await db.query.parcelWatches.findMany()).toHaveLength(1)
  })
})
