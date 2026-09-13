import { expect, it } from 'vitest'
import {
  apiRetentionBoundary,
  retentionSchema,
} from '../src/lib/maintenance/policy'

it('disables deletion until configured and protects thirty complete days of API metrics', () => {
  expect(Object.values(retentionSchema.parse({}))).toEqual([0, 0, 0, 0])
  for (const days of [-1, 1, 29, 30.5, 3651])
    expect(
      retentionSchema.safeParse({ RETENTION_API_REQUEST_DAYS: days }).success,
    ).toBe(false)
  expect(
    retentionSchema.parse({ RETENTION_API_REQUEST_DAYS: '30' })
      .RETENTION_API_REQUEST_DAYS,
  ).toBe(30)
})
it('uses Prague calendar days across midnight and DST rather than subtracting 24-hour durations', () => {
  expect(apiRetentionBoundary(new Date('2026-03-30T22:30:00Z'), 30)).toBe(
    '2026-03-01',
  )
  expect(apiRetentionBoundary(new Date('2026-10-26T23:30:00Z'), 30)).toBe(
    '2026-09-27',
  )
})
