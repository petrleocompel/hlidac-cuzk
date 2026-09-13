import { describe, expect, it } from 'vitest'
import {
  filterKatastralniUzemi,
  formatParcelNumberInput,
  parseParcelNumber,
} from '../src/lib/cuzk/parcel-input'
import { parseCsv } from '../src/lib/csv'
import { IMPORT_ROW_LIMIT, planWatchImport } from '../src/lib/cuzk/watch-import'

const KU = [
  { kod: 777552, nazev: 'Vejprnice' },
  { kod: 733857, nazev: 'Žďár nad Sázavou' },
  { kod: 733858, nazev: 'Nové Vejprnice' },
  { kod: 600016, nazev: 'Plzeň' },
]

describe('parcel number input', () => {
  it('accepts the notations people write', () => {
    expect(parseParcelNumber('1133/77')).toEqual({
      kmenoveCisloParcely: 1133,
      poddeleniCislaParcely: 77,
      druhCislovani: 2,
    })
    expect(parseParcelNumber(' 1133 / 77 ')).toMatchObject({
      poddeleniCislaParcely: 77,
    })
    expect(parseParcelNumber('1133')).toMatchObject({
      poddeleniCislaParcely: null,
      druhCislovani: 2,
    })
    expect(parseParcelNumber('st. 25')).toMatchObject({
      kmenoveCisloParcely: 25,
      druhCislovani: 1,
    })
    expect(parseParcelNumber('St.25/2')).toMatchObject({
      kmenoveCisloParcely: 25,
      poddeleniCislaParcely: 2,
      druhCislovani: 1,
    })
  })

  it('refuses what it cannot read instead of guessing', () => {
    expect(() => parseParcelNumber('')).toThrow(/Zadejte parcelní číslo/)
    expect(() => parseParcelNumber('1133/77/3')).toThrow(/nerozumím/)
    expect(() => parseParcelNumber('parcela 7')).toThrow(/nerozumím/)
    expect(() => parseParcelNumber('0')).toThrow(/větší než nula/)
    expect(() => parseParcelNumber('1133/0')).toThrow(/nemůže být nula/)
  })

  it('formats a parcel back into one field', () => {
    expect(
      formatParcelNumberInput({
        kmenoveCisloParcely: 1133,
        poddeleniCislaParcely: 77,
        druhCislovani: 2,
      }),
    ).toBe('1133/77')
    expect(
      formatParcelNumberInput({
        kmenoveCisloParcely: 25,
        poddeleniCislaParcely: null,
        druhCislovani: 1,
      }),
    ).toBe('st. 25')
  })
})

describe('katastrální území search', () => {
  it('finds a name written without diacritics', () => {
    expect(
      filterKatastralniUzemi(KU, 'zdar nad sazavou').map((ku) => ku.kod),
    ).toEqual([733857])
  })

  it('prefers names starting with the query', () => {
    expect(
      filterKatastralniUzemi(KU, 'vejprnice').map((ku) => ku.nazev),
    ).toEqual(['Vejprnice', 'Nové Vejprnice'])
  })

  it('matches an exact code and a code prefix', () => {
    expect(filterKatastralniUzemi(KU, '777552')).toEqual([KU[0]])
    expect(filterKatastralniUzemi(KU, '7338').map((ku) => ku.kod)).toEqual([
      733857, 733858,
    ])
    expect(filterKatastralniUzemi(KU, 'V')).toEqual([])
  })
})

describe('csv reader', () => {
  it('reads quoted fields, semicolons and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x,1","y""z"\r\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'y"z'],
    ])
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('import plan', () => {
  const existing = [
    {
      kuCode: '777552',
      parcelNumber: 1133,
      parcelSubdivision: 77,
      druhCislovani: 2,
    },
  ]

  it('keeps valid rows when other rows are wrong', () => {
    const csv = [
      'nazev,ku_kod,parcela,interval',
      'Chata,777552,991/2,60',
      'Špatná,777552,neco,60',
      'Bez KÚ,,12,60',
      'Interval,777552,993,1',
      'Duplicita,777552,1133/77,60',
      'Stavební,777552,st. 25,',
      'Znovu,777552,991/2,120',
    ].join('\n')
    const plan = planWatchImport(csv, 'csv', existing)
    expect(plan.error).toBeUndefined()
    expect(plan.rows.map((row) => row.status)).toEqual([
      'ok',
      'invalid',
      'invalid',
      'invalid',
      'duplicate',
      'ok',
      'duplicate_in_file',
    ])
    expect(plan.ready).toBe(2)
    expect(plan.skipped).toBe(5)
    expect(plan.apiCalls).toBe(2)
    expect(plan.rows[1].message).toMatch(/nerozumím/)
    expect(plan.rows[3].message).toMatch(/5–1440/)
    expect(plan.rows[5].candidate).toMatchObject({
      druhCislovani: 1,
      kmenoveCisloParcely: 25,
      pollIntervalMinutes: 1440,
      label: 'Stavební',
    })
  })

  it('reads JSON as a list or under a watches key', () => {
    const rows = [{ nazev: 'A', ku_kod: '777552', parcela: '5/1' }]
    expect(planWatchImport(JSON.stringify(rows), 'json', []).ready).toBe(1)
    const wrapped = planWatchImport(
      JSON.stringify({ watches: [{ kuCode: '777552', parcel: '5/1' }] }),
      'json',
      [],
    )
    expect(wrapped.ready).toBe(1)
    expect(wrapped.rows[0].candidate?.label).toBe('777552 5/1')
    expect(planWatchImport('{]', 'json', []).error).toMatch(/platný JSON/)
    expect(planWatchImport('{"a":1}', 'json', []).error).toMatch(/seznam/)
  })

  it('requires the csv header to name the columns', () => {
    expect(planWatchImport('777552,1133/77', 'csv', []).error).toMatch(
      /záhlaví/,
    )
    expect(planWatchImport('', 'csv', []).error).toMatch(/žádné řádky/)
  })

  it('stops at the row limit instead of queueing thousands of calls', () => {
    const rows = Array.from(
      { length: IMPORT_ROW_LIMIT + 2 },
      (_, i) => `P${i},777552,${i + 1}/1,60`,
    )
    const plan = planWatchImport(
      ['nazev,ku_kod,parcela,interval', ...rows].join('\n'),
      'csv',
      [],
    )
    expect(plan.ready).toBe(IMPORT_ROW_LIMIT)
    expect(plan.rows.at(-1)?.message).toMatch(
      new RegExp(String(IMPORT_ROW_LIMIT)),
    )
  })
})
