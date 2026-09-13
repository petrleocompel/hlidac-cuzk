import { createServer } from 'node:http'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import { cuzkApiControl, parcelWatches, user } from '../../src/db/schema'
import {
  createVerifiedObjectWatch,
  lookupAddressForWatch,
} from '../../src/lib/cuzk/watch-create'
import {
  clearRuianCaches,
  resolveAddressPlaces,
  suggestAddresses,
} from '../../src/lib/ruian/geocode'

const now = new Date('2026-04-01T10:00:00Z')
const ADDRESS = 'Politických vězňů 123, 33027 Vejprnice'
let requests: string[] = []
let addressPlaces: Array<Record<string, unknown>> = []
let knownAddressPlace = 759678

/** Serves both the RÚIAN MapServer and the KN API used by the address flow. */
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture')
  requests.push(url.pathname)
  response.setHeader('Content-Type', 'application/json')
  if (url.pathname.endsWith('/exts/GeocodeSOE/suggest')) {
    response.end(
      JSON.stringify({
        suggestions: [
          { text: ADDRESS, magicKey: '1_1439039', type: 'AdresniMisto' },
          {
            text: 'Vejprnice 1133/77',
            magicKey: '0_1',
            type: 'ParcelaDefinicniBod',
          },
        ],
      }),
    )
    return
  }
  if (url.pathname.endsWith('/1/query')) {
    response.end(JSON.stringify({ features: addressPlaces }))
    return
  }
  if (url.pathname.startsWith('/api/v1/Stavby/AdresniMisto/')) {
    const kod = Number(url.pathname.split('/').pop())
    if (kod !== knownAddressPlace) {
      response.end(JSON.stringify({ data: null, zpravy: [] }))
      return
    }
    response.end(
      JSON.stringify({
        aktualnostDatK: '2026-04-01T09:00:00Z',
        data: {
          id: 55,
          typStavby: { kod: 1, nazev: 'rodinný dům' },
          cislaDomovni: [123],
          castObce: { kod: 400611, nazev: 'Vejprnice' },
          lv: {
            id: 10,
            cislo: 2978,
            katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          },
          jednotky: [{ id: 70, cisloJednotky: 1 }],
          parcely: [
            {
              id: 3,
              kmenoveCisloParcely: 25,
              druhCislovaniParcely: 1,
              katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
            },
          ],
          adresniMista: [759678],
          rizeniPlomby: [],
        },
      }),
    )
    return
  }
  if (url.pathname.startsWith('/api/v1/Stavby/')) {
    response.end(
      JSON.stringify({
        data: {
          id: 55,
          typStavby: { kod: 1, nazev: 'rodinný dům' },
          cislaDomovni: [123],
          castObce: { nazev: 'Vejprnice' },
          lv: {
            id: 10,
            cislo: 2978,
            katastralniUzemi: { kod: 777552, nazev: 'Vejprnice' },
          },
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
  const base = `http://127.0.0.1:${address.port}`
  process.env.CUZK_API_BASE_URL = base
  process.env.RUIAN_GEOCODE_URL = base
})

beforeEach(async () => {
  await db.delete(user)
  await db.delete(cuzkApiControl)
  clearRuianCaches()
  requests = []
  knownAddressPlace = 759678
  addressPlaces = [
    {
      attributes: {
        kod: 759678,
        adresa: ADDRESS,
        cislodomovni: 123,
        psc: 33027,
        stavebniobjekt: 757560,
      },
    },
  ]
  await db.insert(user).values({
    id: 'address-owner',
    name: 'Owner',
    email: 'address@example.test',
  })
})

afterAll(async () => {
  delete process.env.RUIAN_GEOCODE_URL
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('adding a watch by address (PostgreSQL)', () => {
  it('suggests only addresses and resolves them to the KN building', async () => {
    expect(await suggestAddresses('Vejprnice 123')).toEqual([
      { text: ADDRESS, magicKey: '1_1439039' },
    ])
    const places = await resolveAddressPlaces(ADDRESS)
    expect(places).toHaveLength(1)
    expect(places[0]).toMatchObject({
      kod: 759678,
      ruianStavebniObjekt: 757560,
    })

    const resolved = await lookupAddressForWatch(
      'address-owner',
      places[0],
      now,
    )
    expect(resolved.place.kod).toBe(759678)
    expect(resolved.building).toMatchObject({
      objectType: 'stavba',
      isknId: '55',
      kuCode: '777552',
      lvCislo: 2978,
      alreadyWatchedId: null,
    })
    // The RÚIAN address place code is the bridge; the KN id comes from ČÚZK.
    expect(requests).toContain('/api/v1/Stavby/AdresniMisto/759678')
    expect(resolved.links).toEqual([
      { objectType: 'jednotka', isknId: '70', label: '1 [70]' },
      { objectType: 'parcel', isknId: '3', label: 'st. 25 (Vejprnice) [3]' },
    ])

    const watch = await createVerifiedObjectWatch({
      userId: 'address-owner',
      objectType: 'stavba',
      isknId: resolved.building.isknId,
      pollIntervalMinutes: 1440,
      now,
    })
    expect(watch.objectType).toBe('stavba')
    const again = await lookupAddressForWatch('address-owner', places[0], now)
    expect(again.building.alreadyWatchedId).toBe(watch.id)
  })

  it('returns every candidate of an ambiguous address', async () => {
    addressPlaces = [
      { attributes: { kod: 1, adresa: 'Dlouhá 1, 11000 Praha' } },
      { attributes: { kod: 2, adresa: 'Dlouhá 1, 11000 Praha' } },
    ]
    const places = await resolveAddressPlaces('Dlouhá 1, 11000 Praha')
    expect(places.map((place) => place.kod)).toEqual([1, 2])
    expect(await db.select().from(parcelWatches)).toHaveLength(0)
  })

  it('refuses an address the registers cannot link to a building', async () => {
    knownAddressPlace = 1
    await expect(
      lookupAddressForWatch(
        'address-owner',
        {
          kod: 759678,
          adresa: ADDRESS,
          cisloDomovni: 123,
          cisloOrientacni: null,
          psc: 33027,
          ruianStavebniObjekt: 757560,
        },
        now,
      ),
    ).rejects.toThrow(/nevrací stavbu/)
    expect(await db.select().from(parcelWatches)).toHaveLength(0)
  })

  it('never resolves an address that RÚIAN does not match exactly', async () => {
    addressPlaces = []
    expect(await resolveAddressPlaces('Neexistující 999')).toEqual([])
    expect(requests.filter((path) => path.startsWith('/api/v1/'))).toHaveLength(
      0,
    )
  })
})
