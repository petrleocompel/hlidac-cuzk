import { describe, expect, it } from 'vitest'
import {
  BulkWatchInput,
  EMPTY_WATCH_FILTERS,
  OrganizationInput,
  WatchTags,
  matchesWatch,
} from '../src/lib/watch-organization'

const watch = {
  label: 'Chalupa',
  notes: 'Opravit střešní okno',
  tags: ['Rodina'],
  kuCode: '777552',
  kuName: 'Vejprnice',
  isknId: '123',
  objectSummary: null,
  parcelNumber: 42,
  parcelSubdivision: 3,
  enabled: false,
  lastError: 'timeout',
  lastSnapshotJson: {
    version: 1,
    objectType: 'pravo_stavby',
    object: { id: '123', lv: { cislo: 20 } },
    rizeni: [{ id: '1' }],
  },
}
describe('portfolio organization', () => {
  it('matches words without accents across private notes and identification', () => {
    expect(
      matchesWatch(watch, {
        ...EMPTY_WATCH_FILTERS,
        query: 'streSni VEJPRNICE 42/3',
      }),
    ).toBe(true)
    expect(
      matchesWatch(watch, { ...EMPTY_WATCH_FILTERS, query: 'missing' }),
    ).toBe(false)
  })
  it('combines exact KU and LV with independent status and tag filters', () => {
    expect(
      matchesWatch(watch, {
        ...EMPTY_WATCH_FILTERS,
        ku: '777552',
        lv: '20',
        status: 'paused',
        tag: 'rodina',
      }),
    ).toBe(true)
    expect(
      matchesWatch(watch, { ...EMPTY_WATCH_FILTERS, ku: '777553', lv: '20' }),
    ).toBe(false)
    expect(matchesWatch(watch, { ...EMPTY_WATCH_FILTERS, lv: '2' })).toBe(false)
    expect(
      matchesWatch(watch, { ...EMPTY_WATCH_FILTERS, status: 'active' }),
    ).toBe(false)
    for (const status of ['error', 'plomba'] as const)
      expect(matchesWatch(watch, { ...EMPTY_WATCH_FILTERS, status })).toBe(true)
    expect(
      matchesWatch(
        { ...watch, lastSnapshotJson: null },
        { ...EMPTY_WATCH_FILTERS, lv: '20' },
      ),
    ).toBe(false)
  })
  it('bounds and normalizes metadata and rejects empty or oversized batches', () => {
    expect(WatchTags.parse([' Dům ', 'dum', 'Rodina'])).toEqual([
      'Dům',
      'Rodina',
    ])
    for (const tags of [Array(21).fill('tag'), ['a'.repeat(41)], [''], ['a,b']])
      expect(WatchTags.safeParse(tags).success).toBe(false)
    expect(
      OrganizationInput.safeParse({
        id: 'f779d7fa-1111-4111-8111-111111111111',
        label: 'a',
        notes: 'a'.repeat(5001),
        tags: [],
      }).success,
    ).toBe(false)
    for (const v of [
      { ids: [], enabled: false },
      {
        ids: Array(101).fill('f779d7fa-1111-4111-8111-111111111111'),
        enabled: false,
      },
      { ids: ['f779d7fa-1111-4111-8111-111111111111'] },
      { ids: ['f779d7fa-1111-4111-8111-111111111111'], pollIntervalMinutes: 4 },
    ])
      expect(BulkWatchInput.safeParse(v).success).toBe(false)
  })
})
