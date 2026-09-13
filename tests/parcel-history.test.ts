import { describe, expect, it } from 'vitest'
import {
  diffParcelAttrs,
  diffSnapshots,
  formatParcelAttrValue,
  parcelAttrLabel,
  parseSnapshotChange,
} from '../src/lib/cuzk/snapshot'
import type { ParcelSnapshot } from '../src/lib/cuzk/snapshot'
import {
  describeChanges,
  summarizeEvent,
} from '../src/lib/notifications/message'
import { csvCell } from '../src/lib/csv'

function parcel(
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
    zpusobyOchrany: ['zemědělský půdní fond'],
    bpej: [
      { kod: 52011, vymera: 500 },
      { kod: 52014, vymera: 476 },
    ],
    definicniBod: null,
    stavbaId: null,
    pravoStavbyId: null,
    ...overrides,
  }
}

function snapshot(
  parcelOverrides: Partial<ParcelSnapshot['parcel']> = {},
): ParcelSnapshot {
  return {
    version: 1,
    fetchedAt: '2026-09-13T08:00:00.000Z',
    aktualnostDatK: '2026-09-12T23:00:00.000Z',
    parcel: parcel(parcelOverrides),
    rizeni: [],
  }
}

describe('parcel attribute history', () => {
  it('ignores reordered BPEJ and protections', () => {
    const reordered = parcel({
      bpej: [
        { kod: 52014, vymera: 476 },
        { kod: 52011, vymera: 500 },
      ],
      zpusobyOchrany: ['zemědělský půdní fond'],
    })
    expect(diffParcelAttrs(parcel(), reordered)).toEqual([])
    expect(diffSnapshots(snapshot(), snapshot(reordered))).toEqual([])
  })

  it('records the previous and the new value', () => {
    const changes = diffSnapshots(snapshot(), snapshot({ vymera: 980 }))
    expect(changes).toHaveLength(1)
    const change = changes[0]
    expect(change.kind === 'parcel_attrs' && change.values).toEqual([
      { field: 'vymera', previous: 976, next: 980 },
    ])
    expect(describeChanges(changes)).toContain('Výměra: 976 m² → 980 m²')
  })

  it('treats an unreturned list as unknown, not as a removal', () => {
    expect(diffParcelAttrs(parcel(), parcel({ bpej: null }))).toEqual([])
    expect(diffParcelAttrs(parcel({ bpej: null }), parcel())).toEqual([])
    // An empty list that the API did return is a real change.
    expect(diffParcelAttrs(parcel(), parcel({ bpej: [] }))).toEqual([
      { field: 'bpej', previous: parcel().bpej, next: [] },
    ])
  })

  it('reports a real BPEJ value change with both sides', () => {
    const next = parcel({
      bpej: [
        { kod: 52011, vymera: 520 },
        { kod: 52014, vymera: 456 },
      ],
    })
    const [diff] = diffParcelAttrs(parcel(), next)
    expect(diff.field).toBe('bpej')
    expect(formatParcelAttrValue('bpej', diff.previous)).toContain(
      '52011 (500 m²)',
    )
    expect(formatParcelAttrValue('bpej', diff.next)).toContain('52011 (520 m²)')
  })

  it('detects a new building and right-of-building link', () => {
    const diffs = diffParcelAttrs(
      parcel(),
      parcel({ stavbaId: '55', pravoStavbyId: '66' }),
    )
    expect(diffs.map((diff) => diff.field)).toEqual([
      'stavbaId',
      'pravoStavbyId',
    ])
    expect(parcelAttrLabel('stavbaId')).toBe('Vazba na stavbu (ISKN)')
  })

  it('names a missing value as unreported instead of inventing one', () => {
    expect(formatParcelAttrValue('druhPozemku', null)).toBe('neuvedeno')
    expect(formatParcelAttrValue('zpusobyOchrany', [])).toBe('žádné')
    expect(formatParcelAttrValue('bpej', [])).toBe('bez BPEJ')
  })

  it('summarizes stored events for the export', () => {
    const change = diffSnapshots(snapshot(), snapshot({ vymera: 980 }))[0]
    expect(
      summarizeEvent({ kind: 'parcel_attrs', payloadJson: change }),
    ).toContain('976 m² → 980 m²')
    expect(
      summarizeEvent({ kind: 'error', payloadJson: { message: 'Timeout' } }),
    ).toBe('Timeout')
    expect(summarizeEvent({ kind: 'error', payloadJson: null })).toBe(
      'Kontrola selhala.',
    )
  })

  it('reads older events that stored field names only', () => {
    const legacy = parseSnapshotChange({
      kind: 'parcel_attrs',
      fields: ['vymera'],
    })
    expect(legacy?.kind).toBe('parcel_attrs')
    expect(describeChanges([legacy!])).toBe('Změna atributů parcely: vymera')
  })

  it('quotes and defuses exported cells', () => {
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`)
    expect(csvCell('Vklad 1/2026')).toBe('"Vklad 1/2026"')
  })
})
