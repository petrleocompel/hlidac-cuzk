import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import { cuzkApiControl, parcelWatches, user } from '../../src/db/schema'
import {
  createVerifiedWatch,
  importVerifiedWatches,
  lookupParcelForWatch,
} from '../../src/lib/cuzk/watch-create'
import { planWatchImport } from '../../src/lib/cuzk/watch-import'

let baseUrl: string
const now = new Date('2026-02-01T10:00:00Z')

/** Parcels the fixture API knows, keyed by kmenové/poddělení. */
const catalog = new Map<string, number>([
  ['1133/77', 1],
  ['991/2', 2],
  ['25/', 3],
])
let searchCount = 0
let rateLimited = false

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture')
  response.setHeader('Content-Type', 'application/json')
  if (rateLimited) {
    response.statusCode = 429
    response.setHeader('Retry-After', '120')
    response.end('{}')
    return
  }
  if (url.pathname === '/api/v1/Parcely/Vyhledani') {
    searchCount += 1
    const key = `${url.searchParams.get('KmenoveCisloParcely')}/${
      url.searchParams.get('PoddeleniCislaParcely') ?? ''
    }`
    const id = catalog.get(key)
    response.end(
      JSON.stringify(
        id
          ? {
              data: [
                {
                  id,
                  typParcely: 'PKN',
                  druhCislovaniParcely: Number(
                    url.searchParams.get('DruhCislovaniParcely'),
                  ),
                  kmenoveCisloParcely: Number(
                    url.searchParams.get('KmenoveCisloParcely'),
                  ),
                  poddeleniCislaParcely: url.searchParams.get(
                    'PoddeleniCislaParcely',
                  )
                    ? Number(url.searchParams.get('PoddeleniCislaParcely'))
                    : null,
                  katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
                  vymera: 976,
                  lv: { id: 10, cislo: 2978 },
                  rizeniPlomby: [],
                },
              ],
            }
          : { data: [], zpravy: [{ text: 'Parcela nenalezena.' }] },
      ),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/Parcely/')) {
    const id = url.pathname.split('/').pop()
    response.end(
      JSON.stringify({
        data: {
          id: Number(id),
          typParcely: 'PKN',
          druhCislovaniParcely: 2,
          kmenoveCisloParcely: 1133,
          poddeleniCislaParcely: 77,
          katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          vymera: 976,
          rizeniPlomby: [],
        },
      }),
    )
    return
  }
  response.end('{}')
})

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
  // A previous rate-limit test must not block the shared budget for the next one.
  await db.delete(cuzkApiControl)
  searchCount = 0
  rateLimited = false
  await db
    .insert(user)
    .values({ id: 'create-owner', name: 'Owner', email: 'create@example.test' })
})

afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('creating a watch from a verified parcel (PostgreSQL)', () => {
  it('takes the KÚ code and name from ČÚZK, not from the caller', async () => {
    const lookup = await lookupParcelForWatch('create-owner', {
      kuCode: '777552',
      kmenoveCisloParcely: 1133,
      poddeleniCislaParcely: 77,
      druhCislovani: 2,
    })
    expect(lookup).toMatchObject({
      isknId: '1',
      kuCode: '777552',
      kuName: 'Vejprnice',
      parcelNumber: 1133,
      parcelSubdivision: 77,
      vymera: 976,
      lvCislo: 2978,
      alreadyWatchedId: null,
    })

    const watch = await createVerifiedWatch({
      userId: 'create-owner',
      isknId: lookup.isknId,
      pollIntervalMinutes: 60,
      now,
    })
    expect(watch).toMatchObject({
      kuCode: '777552',
      kuName: 'Vejprnice',
      parcelNumber: 1133,
      parcelSubdivision: 77,
      label: 'Vejprnice 1133/77',
      lastError: null,
    })
    expect(watch.lastSnapshotJson).toMatchObject({ parcel: { id: '1' } })
    expect(watch.lastSuccessfulCheckAt).toEqual(now)

    const again = await lookupParcelForWatch('create-owner', {
      kuCode: '777552',
      kmenoveCisloParcely: 1133,
      poddeleniCislaParcely: 77,
      druhCislovani: 2,
    })
    expect(again.alreadyWatchedId).toBe(watch.id)
  })

  it('refuses a second subscription to the same object', async () => {
    await createVerifiedWatch({
      userId: 'create-owner',
      isknId: '1',
      pollIntervalMinutes: 60,
      now,
    })
    await expect(
      createVerifiedWatch({
        userId: 'create-owner',
        isknId: '1',
        pollIntervalMinutes: 60,
        now,
      }),
    ).rejects.toThrow(/už sledujete/)
    expect(
      await db
        .select()
        .from(parcelWatches)
        .where(eq(parcelWatches.userId, 'create-owner')),
    ).toHaveLength(1)
  })

  it('reports an unknown parcel instead of storing it', async () => {
    await expect(
      lookupParcelForWatch('create-owner', {
        kuCode: '777552',
        kmenoveCisloParcely: 4242,
        poddeleniCislaParcely: null,
        druhCislovani: 2,
      }),
    ).rejects.toThrow(/nenalezena/)
    expect(await db.select().from(parcelWatches)).toHaveLength(0)
  })
})

describe('bulk import (PostgreSQL)', () => {
  const csv = [
    'nazev,ku_kod,parcela,interval',
    'Chata,777552,991/2,60',
    'Neznámá,777552,4242,60',
    'Stavební,777552,st. 25,',
  ].join('\n')

  it('creates valid rows, reports the failing one and spends one call per row', async () => {
    const plan = planWatchImport(csv, 'csv', [])
    expect(plan.ready).toBe(3)
    const outcome = await importVerifiedWatches('create-owner', plan, now)
    expect(outcome.created.map((row) => row.label)).toEqual([
      'Chata',
      'Stavební',
    ])
    expect(outcome.failed).toEqual([
      {
        line: 2,
        raw: 'Neznámá · 777552 · 4242 · 60',
        message: 'Parcela nenalezena.',
      },
    ])
    expect(searchCount).toBe(3)
    const rows = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, 'create-owner'))
    expect(rows).toHaveLength(2)
    // The import only verifies identity; the first snapshot is left to the worker.
    expect(rows.every((row) => row.lastSnapshotJson === null)).toBe(true)
    expect(
      rows.every((row) => row.nextCheckAt?.getTime() === now.getTime()),
    ).toBe(true)
    expect(rows.find((row) => row.label === 'Stavební')).toMatchObject({
      kuName: 'Vejprnice',
      parcelNumber: 25,
      druhCislovani: 1,
    })
  })

  it('skips rows the user already watches and does not call ČÚZK for them', async () => {
    await importVerifiedWatches(
      'create-owner',
      planWatchImport(csv, 'csv', []),
      now,
    )
    searchCount = 0
    const existing = await db
      .select({
        kuCode: parcelWatches.kuCode,
        parcelNumber: parcelWatches.parcelNumber,
        parcelSubdivision: parcelWatches.parcelSubdivision,
        druhCislovani: parcelWatches.druhCislovani,
      })
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, 'create-owner'))
    const plan = planWatchImport(csv, 'csv', existing)
    expect(plan.ready).toBe(1)
    expect(plan.rows.filter((row) => row.status === 'duplicate')).toHaveLength(
      2,
    )
    const outcome = await importVerifiedWatches('create-owner', plan, now)
    expect(outcome.created).toEqual([])
    expect(outcome.failed.at(0)?.message).toBe('Parcela nenalezena.')
    expect(searchCount).toBe(1)
  })

  it('stops the import when ČÚZK limits the calls and says which rows were left', async () => {
    rateLimited = true
    const plan = planWatchImport(csv, 'csv', [])
    const outcome = await importVerifiedWatches('create-owner', plan, now)
    expect(outcome.created).toEqual([])
    expect(outcome.stoppedReason).toMatch(/omezilo/)
    expect(outcome.failed).toHaveLength(3)
    expect(outcome.failed.at(-1)?.message).toMatch(/nebyl zpracován/)
    expect(await db.select().from(parcelWatches)).toHaveLength(0)
  })
})
