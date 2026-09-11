import { expect, it } from 'vitest'
import { dataAge, isWatchStale } from '../src/lib/monitoring/freshness'

it('distinguishes missing and stale data and respects paused watches', () => {
  const now = Date.parse('2026-01-01T12:00:00Z')
  const watch = {
    enabled: true,
    createdAt: '2026-01-01T10:00:00Z',
    lastSuccessfulCheckAt: null,
    pollIntervalMinutes: 60,
  }
  expect(dataAge(null, now)).toBe('Bez úspěšných dat')
  expect(dataAge(watch.createdAt, now)).toBe('Stáří dat: 2 h')
  expect(isWatchStale(watch, now)).toBe(true)
  expect(isWatchStale({ ...watch, enabled: false }, now)).toBe(false)
  expect(
    isWatchStale(
      { ...watch, lastSuccessfulCheckAt: '2026-01-01T11:00:00Z' },
      now,
    ),
  ).toBe(false)
})
