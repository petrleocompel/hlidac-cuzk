import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiControl,
  parcelWatches,
  user,
  watchEvents,
} from '../../src/db/schema'
import {
  createVerifiedObjectWatch,
  lookupBuildingOrUnit,
  lookupObjectForWatch,
} from '../../src/lib/cuzk/watch-create'
import { pollWatchById } from '../../src/cron/jobs/poll-parcels'
import {
  isObjectSnapshot,
  parseWatchSnapshot,
} from '../../src/lib/cuzk/object-snapshot'

let baseUrl: string
const now = new Date('2026-03-01T10:00:00Z')

const state = {
  zpusobVyuziti: { kod: 6, nazev: 'bydlení' },
  jednotky: [
    { id: 70, cisloJednotky: 1 },
    { id: 71, cisloJednotky: 2 },
  ] as Array<{ id: number; cisloJednotky: number }> | null,
  plomby: [] as Array<Record<string, unknown>>,
  stavbaStatus: 200,
}
const requests: string[] = []

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture')
  requests.push(url.pathname)
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/api/v1/Stavby/Vyhledani') {
    const cislo = Number(url.searchParams.get('CisloDomovni'))
    response.end(
      JSON.stringify(
        cislo === 123
          ? { data: [{ id: 55, cislaDomovni: [123] }] }
          : { data: [], zpravy: [{ text: 'Stavba nenalezena.' }] },
      ),
    )
    return
  }
  if (url.pathname === '/api/v1/Jednotky/Vyhledani') {
    const unit = Number(url.searchParams.get('CisloJednotky'))
    response.end(
      JSON.stringify(
        unit === 1
          ? { data: [{ id: 70, cisloJednotky: 1 }] }
          : { data: [], zpravy: [{ text: 'Jednotka nenalezena.' }] },
      ),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/Stavby/')) {
    response.statusCode = state.stavbaStatus
    if (state.stavbaStatus !== 200) {
      response.end('{}')
      return
    }
    response.end(
      JSON.stringify({
        aktualnostDatK: '2026-03-01T09:00:00Z',
        data: {
          id: 55,
          typStavby: { kod: 1, nazev: 'rodinný dům' },
          cislaDomovni: [123],
          castObce: { kod: 400611, nazev: 'Vejprnice' },
          obec: { kod: 559199, nazev: 'Vejprnice' },
          docasna: false,
          typyVazby: 'PostavenaNaPozemku',
          lv: {
            id: 10,
            cislo: 2978,
            katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          },
          pravoStavby: { id: 91 },
          zpusobVyuziti: state.zpusobVyuziti,
          zpusobyOchrany: [{ kod: 1, nazev: 'památková zóna' }],
          parcely: [
            {
              id: 3,
              kmenoveCisloParcely: 25,
              druhCislovaniParcely: 1,
              katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
            },
          ],
          jednotky: state.jednotky,
          adresniMista: [12345],
          rizeniPlomby: state.plomby,
        },
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/Jednotky/')) {
    response.end(
      JSON.stringify({
        data: {
          id: 70,
          cisloJednotky: 1,
          typJednotky: { kod: 2, nazev: 'byt' },
          podilNaSpolecnychCastechDomu: { citatel: 1, jmenovatel: 24 },
          lv: {
            id: 12,
            cislo: 3100,
            katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          },
          vymezenaVeStavbe: {
            id: 55,
            typStavby: { kod: 1 },
            cislaDomovni: [123],
            castObce: { nazev: 'Vejprnice' },
          },
          rizeniPlomby: [],
        },
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/PravaStavby/')) {
    response.end(
      JSON.stringify({
        data: {
          id: 91,
          datumUkonceni: '2046-01-01T00:00:00',
          datumPrijeti: '2016-01-01T00:00:00',
          ucelyPravaStavby: [{ kod: 1, nazev: 'rodinný dům' }],
          lv: {
            id: 13,
            cislo: 3200,
            katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          },
          parcely: [{ id: 3, kmenoveCisloParcely: 25 }],
          stavby: [{ id: 55, cislaDomovni: [123] }],
          rizeniPlomby: [],
        },
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/Rizeni/')) {
    response.end(
      JSON.stringify({
        data: {
          id: 800,
          typRizeni: 'V',
          poradoveCislo: 5,
          rok: 2026,
          stav: 'Probíhá řízení',
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
  await db.delete(cuzkApiControl)
  state.zpusobVyuziti = { kod: 6, nazev: 'bydlení' }
  state.jednotky = [
    { id: 70, cisloJednotky: 1 },
    { id: 71, cisloJednotky: 2 },
  ]
  state.plomby = []
  state.stavbaStatus = 200
  requests.length = 0
  await db
    .insert(user)
    .values({ id: 'object-owner', name: 'Owner', email: 'object@example.test' })
})

afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('watching a building (PostgreSQL)', () => {
  it('stores only what the register returns and keeps parcel fields empty', async () => {
    const lookup = await lookupBuildingOrUnit(
      'object-owner',
      {
        objectType: 'stavba',
        kodCastiObce: 400611,
        typStavby: 1,
        cisloDomovni: 123,
      },
      now,
    )
    expect(lookup).toMatchObject({
      objectType: 'stavba',
      isknId: '55',
      summary: 'č.p. 123, Vejprnice [55]',
      kuCode: '777552',
      kuName: 'Vejprnice',
      lvCislo: 2978,
      plomby: 0,
      alreadyWatchedId: null,
    })
    // The search result is only a pointer; the detail is the verified source.
    expect(requests).toEqual(['/api/v1/Stavby/Vyhledani', '/api/v1/Stavby/55'])

    const watch = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'stavba',
      isknId: '55',
      pollIntervalMinutes: 1440,
      now,
    })
    expect(watch).toMatchObject({
      objectType: 'stavba',
      isknId: '55',
      kuCode: '777552',
      kuName: 'Vejprnice',
      parcelNumber: null,
      parcelSubdivision: null,
      lastError: null,
    })
    expect(watch.label).toContain('Stavba')
    const stored = parseWatchSnapshot(watch.lastSnapshotJson)
    expect(stored && isObjectSnapshot(stored)).toBe(true)
    if (!stored || !isObjectSnapshot(stored)) throw new Error('missing')
    expect(stored.object.attrs).toMatchObject({
      typStavby: 'rodinný dům',
      castObce: 'Vejprnice',
      docasna: false,
      zpusobVyuziti: 'bydlení',
      // RÚIAN codes are kept as address places, never as KN ids.
      adresniMista: ['12345'],
    })
    expect(stored.object.links).toMatchObject({
      parcelIds: ['3'],
      jednotkaIds: ['70', '71'],
      pravoStavbyId: '91',
    })
  })

  it('reports a building attribute change and a new plomba', async () => {
    const watch = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'stavba',
      isknId: '55',
      pollIntervalMinutes: 1440,
      now,
    })
    state.zpusobVyuziti = { kod: 7, nazev: 'jiná stavba' }
    state.jednotky = [{ id: 70, cisloJednotky: 1 }]
    state.plomby = [{ id: 800, typRizeni: 'V', poradoveCislo: 5, rok: 2026 }]
    const result = await pollWatchById(
      watch.id,
      new Date(now.getTime() + 86_400_000),
    )
    expect(result.status).toBe('checked')
    expect(result.changes.map((change) => change.kind).sort()).toEqual([
      'new_rizeni',
      'parcel_attrs',
    ])
    const attrs = result.changes.find(
      (change) => change.kind === 'parcel_attrs',
    )
    expect(attrs?.kind === 'parcel_attrs' && attrs.values).toEqual([
      { field: 'zpusobVyuziti', previous: 'bydlení', next: 'jiná stavba' },
      { field: 'jednotky', previous: ['1 [70]', '2 [71]'], next: ['1 [70]'] },
    ])
    const events = await db
      .select()
      .from(watchEvents)
      .where(eq(watchEvents.watchId, watch.id))
    expect(events).toHaveLength(2)
  })

  it('keeps the last known snapshot when the register call fails', async () => {
    const watch = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'stavba',
      isknId: '55',
      pollIntervalMinutes: 1440,
      now,
    })
    state.stavbaStatus = 500
    await expect(
      pollWatchById(watch.id, new Date(now.getTime() + 86_400_000)),
    ).rejects.toThrow()
    const row = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, watch.id),
    })
    const stored = parseWatchSnapshot(row?.lastSnapshotJson)
    expect(stored && isObjectSnapshot(stored) && stored.object.id).toBe('55')
    expect(row?.lastError).toBeTruthy()
    expect(row?.lastSuccessfulCheckAt).toEqual(now)
  })
})

describe('watching a unit and a right of superficies (PostgreSQL)', () => {
  it('watches a unit with its own LV and building link', async () => {
    const lookup = await lookupBuildingOrUnit(
      'object-owner',
      {
        objectType: 'jednotka',
        kodCastiObce: 400611,
        typStavby: 1,
        cisloDomovni: 123,
        cisloJednotky: 1,
      },
      now,
    )
    expect(lookup).toMatchObject({
      objectType: 'jednotka',
      isknId: '70',
      lvCislo: 3100,
    })
    expect(lookup.summary).toContain('jednotka 1')
    const watch = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'jednotka',
      isknId: '70',
      pollIntervalMinutes: 1440,
      now,
    })
    const stored = parseWatchSnapshot(watch.lastSnapshotJson)
    if (!stored || !isObjectSnapshot(stored)) throw new Error('missing')
    expect(stored.object.attrs).toMatchObject({
      typJednotky: 'byt',
      podilNaSpolecnychCastech: '1/24',
      stavbaId: '55',
    })
    expect(stored.object.links.stavbaIds).toEqual(['55'])
  })

  it('watches a right of superficies added by its ISKN id', async () => {
    const lookup = await lookupObjectForWatch(
      'object-owner',
      'pravo_stavby',
      '91',
      now,
    )
    expect(lookup).toMatchObject({ objectType: 'pravo_stavby', isknId: '91' })
    expect(
      lookup.attrs.find((attr) => attr.field === 'datumUkonceni')?.value,
    ).toContain('2046')
    const watch = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'pravo_stavby',
      isknId: '91',
      pollIntervalMinutes: 1440,
      now,
    })
    expect(watch.objectType).toBe('pravo_stavby')
    expect(
      await lookupObjectForWatch('object-owner', 'pravo_stavby', '91', now),
    ).toMatchObject({ alreadyWatchedId: watch.id })
  })

  it('refuses the same object twice but allows the same id in another register', async () => {
    await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'stavba',
      isknId: '55',
      pollIntervalMinutes: 1440,
      now,
    })
    await expect(
      createVerifiedObjectWatch({
        userId: 'object-owner',
        objectType: 'stavba',
        isknId: '55',
        pollIntervalMinutes: 1440,
        now,
      }),
    ).rejects.toThrow(/už sledujete/)
    // ISKN ids are unique per register, so 70 as a unit is a different object.
    const unit = await createVerifiedObjectWatch({
      userId: 'object-owner',
      objectType: 'jednotka',
      isknId: '70',
      pollIntervalMinutes: 1440,
      now,
    })
    expect(unit.objectType).toBe('jednotka')
    expect(
      await db
        .select()
        .from(parcelWatches)
        .where(eq(parcelWatches.userId, 'object-owner')),
    ).toHaveLength(2)
  })

  it('reports a missing object instead of storing it', async () => {
    await expect(
      lookupBuildingOrUnit(
        'object-owner',
        {
          objectType: 'stavba',
          kodCastiObce: 400611,
          typStavby: 1,
          cisloDomovni: 999,
        },
        now,
      ),
    ).rejects.toThrow(/nenalezena/)
    expect(await db.select().from(parcelWatches)).toHaveLength(0)
  })
})
