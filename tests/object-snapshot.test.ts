import { describe, expect, it } from 'vitest'
import {
  OBJECT_TYPES,
  describeWatchObject,
  diffWatchSnapshots,
  isObjectSnapshot,
  objectAttrDefs,
  objectTypeLabel,
  parseWatchSnapshot,
  snapshotLv,
  snapshotObjectType,
} from '../src/lib/cuzk/object-snapshot'
import type { ObjectSnapshot } from '../src/lib/cuzk/object-snapshot'
import { parcelAttrLabel } from '../src/lib/cuzk/snapshot'
import type { ParcelSnapshot } from '../src/lib/cuzk/snapshot'

const FETCHED = '2026-09-13T08:00:00.000Z'

function object(
  overrides: Partial<ObjectSnapshot['object']> = {},
  objectType: ObjectSnapshot['objectType'] = 'stavba',
): ObjectSnapshot {
  return {
    version: 1,
    objectType,
    fetchedAt: FETCHED,
    aktualnostDatK: '2026-09-12T23:00:00Z',
    object: {
      id: '55',
      summary: 'č.p. 123, Vejprnice',
      kuKod: 777552,
      kuNazev: 'Vejprnice',
      lv: { id: '10', cislo: 2978, kuKod: 777552, kuNazev: 'Vejprnice' },
      attrs: {
        typStavby: 'rodinný dům',
        cislaDomovni: ['123'],
        castObce: 'Vejprnice',
        obec: 'Vejprnice',
        docasna: false,
        typVazby: 'PostavenaNaPozemku',
        zpusobVyuziti: 'bydlení',
        zpusobyOchrany: ['památková zóna'],
        parcely: ['st. 25 (Vejprnice) [3]'],
        jednotky: ['1 [70]', '2 [71]'],
        adresniMista: ['12345'],
        pravoStavbyId: null,
      },
      links: {
        parcelIds: ['3'],
        stavbaIds: [],
        jednotkaIds: ['70', '71'],
        pravoStavbyId: null,
      },
      ...overrides,
    },
    rizeni: [],
  }
}

function parcel(): ParcelSnapshot {
  return {
    version: 1,
    fetchedAt: FETCHED,
    aktualnostDatK: null,
    parcel: {
      id: '1',
      typParcely: 'PKN',
      druhCislovaniParcely: 2,
      kmenoveCisloParcely: 1133,
      poddeleniCislaParcely: 77,
      kuKod: 777552,
      kuNazev: 'Vejprnice',
      vymera: 976,
      lv: { id: '10', cislo: 2978, kuKod: 777552, kuNazev: 'Vejprnice' },
      mapovyList: null,
      zpusobUrceniVymery: null,
      druhPozemku: 'orná půda',
      zpusobVyuziti: null,
      zpusobyOchrany: [],
      bpej: [],
      definicniBod: null,
      stavbaId: null,
      pravoStavbyId: null,
    },
    rizeni: [],
  }
}

describe('watched registers', () => {
  it('knows the registers it can subscribe to', () => {
    expect([...OBJECT_TYPES]).toEqual([
      'parcel',
      'stavba',
      'jednotka',
      'pravo_stavby',
    ])
    expect(objectTypeLabel('jednotka')).toBe('Jednotka')
    expect(objectTypeLabel('neznamy')).toBe('neznamy')
  })

  it('separates a parcel snapshot from the other registers', () => {
    expect(snapshotObjectType(parcel())).toBe('parcel')
    expect(snapshotObjectType(object())).toBe('stavba')
    expect(isObjectSnapshot(parcel())).toBe(false)
    expect(isObjectSnapshot(object())).toBe(true)
    expect(snapshotLv(object())?.cislo).toBe(2978)
    expect(snapshotLv(parcel())?.cislo).toBe(2978)
  })

  it('registers attribute labels of every register', () => {
    expect(parcelAttrLabel('vymera')).toBe('Výměra')
    expect(parcelAttrLabel('cislaDomovni')).toBe('Čísla domovní')
    expect(parcelAttrLabel('podilNaSpolecnychCastech')).toBe(
      'Podíl na společných částech',
    )
    expect(objectAttrDefs('jednotka').map((def) => def.field)).toContain(
      'cisloJednotky',
    )
    expect(objectAttrDefs('parcel')).toEqual([])
  })
})

describe('reading a stored object snapshot', () => {
  it('keeps a building snapshot and fills missing links', () => {
    const stored = JSON.parse(
      JSON.stringify({
        version: 1,
        objectType: 'jednotka',
        fetchedAt: FETCHED,
        object: {
          id: '70',
          summary: 'jednotka 1',
          attrs: { typJednotky: 'byt' },
        },
      }),
    )
    const parsed = parseWatchSnapshot(stored)
    expect(parsed && isObjectSnapshot(parsed)).toBe(true)
    if (!parsed || !isObjectSnapshot(parsed)) throw new Error('not parsed')
    expect(parsed.object).toMatchObject({ id: '70', summary: 'jednotka 1' })
    expect(parsed.object.links).toEqual({
      parcelIds: [],
      stavbaIds: [],
      jednotkaIds: [],
      pravoStavbyId: null,
    })
    expect(parsed.aktualnostDatK).toBeNull()
  })

  it('still reads legacy parcel payloads', () => {
    const parsed = parseWatchSnapshot(parcel())
    expect(parsed && isObjectSnapshot(parsed)).toBe(false)
    expect(parseWatchSnapshot({ version: 1, objectType: 'stavba' })).toBeNull()
    expect(parseWatchSnapshot(null)).toBeNull()
  })
})

describe('diffing objects of the same register', () => {
  it('reports an attribute change with both values', () => {
    const next = object({
      attrs: { ...object().object.attrs, zpusobVyuziti: 'jiná stavba' },
    })
    const changes = diffWatchSnapshots(object(), next)
    expect(changes).toHaveLength(1)
    const change = changes[0]
    expect(change.kind === 'parcel_attrs' && change.values).toEqual([
      {
        field: 'zpusobVyuziti',
        previous: 'bydlení',
        next: 'jiná stavba',
      },
    ])
  })

  it('ignores a reordered list and a list the API did not return', () => {
    const reordered = object({
      attrs: { ...object().object.attrs, jednotky: ['2 [71]', '1 [70]'] },
    })
    expect(diffWatchSnapshots(object(), reordered)).toEqual([])
    const missing = object({
      attrs: { ...object().object.attrs, jednotky: null },
    })
    expect(diffWatchSnapshots(object(), missing)).toEqual([])
    expect(diffWatchSnapshots(missing, object())).toEqual([])
  })

  it('reports a new unit in the building as a real change', () => {
    const next = object({
      attrs: {
        ...object().object.attrs,
        jednotky: ['1 [70]', '2 [71]', '3 [72]'],
      },
    })
    const [change] = diffWatchSnapshots(object(), next)
    expect(change.kind === 'parcel_attrs' && change.fields).toEqual([
      'jednotky',
    ])
  })

  it('reports an LV change and new plomby like for a parcel', () => {
    const next = object({
      lv: { id: '11', cislo: 3000, kuKod: 777552, kuNazev: 'Vejprnice' },
    })
    expect(diffWatchSnapshots(object(), next).map((c) => c.kind)).toEqual([
      'lv_change',
    ])
    const withPlomba: ObjectSnapshot = {
      ...object(),
      rizeni: [
        {
          id: '700',
          typRizeni: 'V',
          poradoveCislo: 1,
          rok: 2026,
          kodPracoviste: 407,
          datumPrijeti: null,
          stav: null,
          stavUhrady: null,
          provedeneOperace: [],
          poznamky: [],
          isVklad: true,
        },
      ],
    }
    expect(diffWatchSnapshots(object(), withPlomba).map((c) => c.kind)).toEqual(
      ['new_rizeni'],
    )
  })

  it('never compares two different registers', () => {
    const unit = object({}, 'jednotka')
    expect(diffWatchSnapshots(object(), unit)).toEqual([])
    expect(diffWatchSnapshots(parcel(), object())).toEqual([])
  })
})

describe('identification line', () => {
  it('prints a parcel with its number and a building with its summary', () => {
    expect(
      describeWatchObject({
        objectType: 'parcel',
        kuName: 'Vejprnice',
        kuCode: '777552',
        parcelNumber: 1133,
        parcelSubdivision: 77,
      }),
    ).toBe('Vejprnice (777552) · 1133/77')
    expect(
      describeWatchObject({
        objectType: 'stavba',
        objectSummary: 'č.p. 123, Vejprnice',
        kuName: 'Vejprnice',
        kuCode: '777552',
        parcelNumber: null,
        parcelSubdivision: null,
      }),
    ).toBe('Stavba č.p. 123, Vejprnice · Vejprnice (777552)')
  })

  it('never prints empty parcel data for registers without it', () => {
    expect(
      describeWatchObject({
        objectType: 'pravo_stavby',
        objectSummary: null,
        kuName: null,
        kuCode: null,
      }),
    ).toBe('Právo stavby')
    expect(describeWatchObject({ objectType: 'parcel' })).toBe('Parcela')
  })
})

it('preserves a supported building point and rejects unsupported historical coordinates', () => {
  const stored = parseWatchSnapshot(
    object({ definicniBod: { x: -743305, y: -1043590 } }),
  )
  expect(
    stored && isObjectSnapshot(stored) && stored.object.definicniBod,
  ).toEqual({ x: -743305, y: -1043590 })
  const invalid = parseWatchSnapshot(
    object({ definicniBod: { x: 743305, y: 1043590 } }),
  )
  expect(
    invalid && isObjectSnapshot(invalid) && invalid.object.definicniBod,
  ).toBeNull()
})
