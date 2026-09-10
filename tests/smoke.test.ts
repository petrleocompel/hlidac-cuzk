import { describe, expect, it } from 'vitest'
import {
  diffSnapshots,
  formatRizeniHeadline,
  parseSnapshot
  
} from '../src/lib/cuzk/snapshot'
import type {ParcelSnapshot} from '../src/lib/cuzk/snapshot';
import { formatRizeniLabel, rizeniFingerprint } from '../src/lib/cuzk/client'

function emptyParcel(
  overrides: Partial<ParcelSnapshot['parcel']> = {},
): ParcelSnapshot['parcel'] {
  return {
    id: '1',
    typParcely: 'PKN',
    druhCislovaniParcely: 2,
    kmenoveCisloParcely: 1133,
    poddeleniCislaParcely: 77,
    kuKod: 777552,
    kuNazev: 'Vejprnice',
    vymera: 976,
    lv: { id: '10', cislo: 2978, kuKod: 777552, kuNazev: 'Vejprnice' },
    mapovyList: 'DKM',
    zpusobUrceniVymery: null,
    druhPozemku: 'orná půda',
    zpusobVyuziti: null,
    zpusobyOchrany: [],
    bpej: [],
    definicniBod: null,
    stavbaId: null,
    pravoStavbyId: null,
    ...overrides,
  }
}

describe('cuzk helpers', () => {
  it('fingerprints rizeni by id', () => {
    expect(
      rizeniFingerprint([
        { id: 2, poradoveCislo: 1, rok: 2026 },
        { id: 1, poradoveCislo: 2, rok: 2026 },
      ]),
    ).toBe(JSON.stringify(['1', '2']))
  })

  it('formats rizeni label', () => {
    expect(
      formatRizeniLabel({
        id: 1,
        typRizeni: 'V',
        poradoveCislo: 4310,
        rok: 2026,
      }),
    ).toBe('V 4310/2026')
  })
})

describe('parcel snapshot', () => {
  it('parses legacy rizeni array', () => {
    const snap = parseSnapshot([
      { id: 1, typRizeni: 'V', poradoveCislo: 1, rok: 2026 },
    ])
    expect(snap?.rizeni).toHaveLength(1)
    expect(snap?.rizeni[0].isVklad).toBe(true)
  })

  it('detects lv change and new plomba', () => {
    const prev: ParcelSnapshot = {
      version: 1,
      fetchedAt: '2026-01-01T00:00:00.000Z',
      aktualnostDatK: null,
      parcel: emptyParcel(),
      rizeni: [],
    }
    const next: ParcelSnapshot = {
      version: 1,
      fetchedAt: '2026-01-02T00:00:00.000Z',
      aktualnostDatK: null,
      parcel: emptyParcel({
        lv: { id: '11', cislo: 3000, kuKod: 777552, kuNazev: 'Vejprnice' },
      }),
      rizeni: [
        {
          id: '99',
          typRizeni: 'V',
          poradoveCislo: 1,
          rok: 2026,
          kodPracoviste: 407,
          datumPrijeti: null,
          stav: 'plomba',
          stavUhrady: null,
          provedeneOperace: [],
          poznamky: [],
          isVklad: true,
        },
      ],
    }
    const changes = diffSnapshots(prev, next)
    expect(changes.map((c) => c.kind).sort()).toEqual([
      'lv_change',
      'new_rizeni',
    ])
    expect(formatRizeniHeadline(next.rizeni[0])).toContain('Vklad')
  })
})
