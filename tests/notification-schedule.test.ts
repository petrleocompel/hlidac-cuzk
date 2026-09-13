import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  channelsForWatch,
  kindSelected,
  localParts,
  nextDigestAt,
  planDelivery,
  quietHoursActive,
  quietHoursEnd,
  safeTimeZone,
  zonedTimeToUtc,
} from '../src/lib/notifications/schedule'
import type { DeliveryRules } from '../src/lib/notifications/schedule'

function rules(overrides: Partial<DeliveryRules> = {}): DeliveryRules {
  return { ...DEFAULT_RULES, ...overrides }
}

describe('time zone handling', () => {
  it('reads local parts in the configured zone', () => {
    // 21:30 UTC in July is 23:30 in Prague (CEST).
    expect(
      localParts(new Date('2026-07-15T21:30:00Z'), 'Europe/Prague'),
    ).toMatchObject({ year: 2026, month: 7, day: 15, hour: 23, minute: 30 })
    // Past midnight local time the date differs from the UTC date.
    expect(
      localParts(new Date('2026-07-15T23:30:00Z'), 'Europe/Prague'),
    ).toMatchObject({ day: 16, hour: 1, weekday: 4 })
  })

  it('converts a wall clock back to an instant across DST', () => {
    expect(
      zonedTimeToUtc('Europe/Prague', {
        year: 2026,
        month: 1,
        day: 10,
        hour: 8,
      }).toISOString(),
    ).toBe('2026-01-10T07:00:00.000Z')
    expect(
      zonedTimeToUtc('Europe/Prague', {
        year: 2026,
        month: 7,
        day: 10,
        hour: 8,
      }).toISOString(),
    ).toBe('2026-07-10T06:00:00.000Z')
    // 02:30 does not exist on the spring-forward day; it must still be a real instant.
    const skipped = zonedTimeToUtc('Europe/Prague', {
      year: 2026,
      month: 3,
      day: 29,
      hour: 2,
      minute: 30,
    })
    expect(Number.isNaN(skipped.getTime())).toBe(false)
    expect(skipped.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('falls back to Europe/Prague for an unusable zone', () => {
    expect(safeTimeZone('Mars/Olympus')).toBe('Europe/Prague')
    expect(safeTimeZone('America/New_York')).toBe('America/New_York')
  })
})

describe('quiet hours', () => {
  const night = rules({ quietFromMinutes: 22 * 60, quietToMinutes: 7 * 60 })

  it('covers a window that wraps past midnight', () => {
    expect(quietHoursActive(night, new Date('2026-01-10T21:30:00Z'))).toBe(true)
    expect(quietHoursActive(night, new Date('2026-01-10T05:30:00Z'))).toBe(true)
    expect(quietHoursActive(night, new Date('2026-01-10T12:00:00Z'))).toBe(
      false,
    )
  })

  it('ends at the local hour, not at a fixed UTC offset', () => {
    expect(
      quietHoursEnd(night, new Date('2026-01-10T21:30:00Z'))?.toISOString(),
    ).toBe('2026-01-11T06:00:00.000Z')
    expect(
      quietHoursEnd(night, new Date('2026-01-11T05:30:00Z'))?.toISOString(),
    ).toBe('2026-01-11T06:00:00.000Z')
    expect(quietHoursEnd(night, new Date('2026-01-10T12:00:00Z'))).toBeNull()
  })

  it('is off when both ends are equal or unset', () => {
    expect(
      quietHoursActive(
        rules({ quietFromMinutes: 60, quietToMinutes: 60 }),
        new Date('2026-01-10T01:00:00Z'),
      ),
    ).toBe(false)
    expect(quietHoursActive(rules(), new Date())).toBe(false)
  })
})

describe('digest slots', () => {
  it('finds the next daily slot in local time', () => {
    const daily = rules({ digestMode: 'daily', digestHour: 8 })
    expect(
      nextDigestAt(daily, new Date('2026-01-10T06:00:00Z'))?.toISOString(),
    ).toBe('2026-01-10T07:00:00.000Z')
    expect(
      nextDigestAt(daily, new Date('2026-01-10T08:00:00Z'))?.toISOString(),
    ).toBe('2026-01-11T07:00:00.000Z')
  })

  it('finds the next weekly slot on the chosen weekday', () => {
    const weekly = rules({
      digestMode: 'weekly',
      digestHour: 9,
      digestWeekday: 1,
    })
    // 2026-01-10 is a Saturday; the next Monday 09:00 local is the slot.
    expect(
      nextDigestAt(weekly, new Date('2026-01-10T12:00:00Z'))?.toISOString(),
    ).toBe('2026-01-12T08:00:00.000Z')
    expect(nextDigestAt(rules(), new Date())).toBeNull()
  })
})

describe('delivery plan', () => {
  it('sends urgent kinds immediately even during quiet hours', () => {
    const plan = planDelivery(
      rules({
        quietFromMinutes: 22 * 60,
        quietToMinutes: 7 * 60,
        digestMode: 'daily',
      }),
      'new_rizeni',
      new Date('2026-01-10T23:00:00Z'),
    )
    expect(plan).toEqual({ mode: 'now' })
  })

  it('defers a non-urgent kind to the digest', () => {
    const plan = planDelivery(
      rules({ digestMode: 'daily', digestHour: 8 }),
      'parcel_attrs',
      new Date('2026-01-10T06:00:00Z'),
    )
    expect(plan).toMatchObject({ mode: 'digest' })
    expect(plan.mode === 'digest' && plan.at.toISOString()).toBe(
      '2026-01-10T07:00:00.000Z',
    )
  })

  it('waits for the end of quiet hours when no digest is configured', () => {
    const plan = planDelivery(
      rules({ quietFromMinutes: 22 * 60, quietToMinutes: 7 * 60 }),
      'parcel_attrs',
      new Date('2026-01-10T21:30:00Z'),
    )
    expect(plan).toMatchObject({ mode: 'delayed', reason: 'quiet' })
    expect(plan.mode === 'delayed' && plan.at.toISOString()).toBe(
      '2026-01-11T06:00:00.000Z',
    )
  })

  it('sends right away outside quiet hours', () => {
    expect(
      planDelivery(
        rules({ quietFromMinutes: 22 * 60, quietToMinutes: 7 * 60 }),
        'parcel_attrs',
        new Date('2026-01-10T12:00:00Z'),
      ),
    ).toEqual({ mode: 'now' })
  })
})

describe('per-watch rules', () => {
  it('intersects configured channels with the watch selection', () => {
    expect(channelsForWatch(['gotify', 'slack'], null)).toEqual([
      'gotify',
      'slack',
    ])
    expect(channelsForWatch(['gotify', 'slack'], ['slack', 'ntfy'])).toEqual([
      'slack',
    ])
    expect(channelsForWatch(['gotify'], [])).toEqual([])
  })

  it('filters kinds without hiding them from the history', () => {
    expect(kindSelected(null, 'parcel_attrs')).toBe(true)
    expect(kindSelected(['new_rizeni'], 'parcel_attrs')).toBe(false)
    expect(kindSelected(['new_rizeni'], 'new_rizeni')).toBe(true)
  })
})

describe('calendar dates across clock changes', () => {
  it('ends the night after the 25-hour autumn day on the next calendar date', () => {
    expect(
      quietHoursEnd(
        rules({ quietFromMinutes: 1320, quietToMinutes: 420 }),
        new Date('2026-10-25T21:30:00Z'),
      )?.toISOString(),
    ).toBe('2026-10-26T06:00:00.000Z')
  })
  it('does not skip tomorrow when spring changes the UTC offset', () => {
    expect(
      nextDigestAt(
        rules({ digestMode: 'daily' }),
        new Date('2026-03-28T22:30:00Z'),
      )?.toISOString(),
    ).toBe('2026-03-29T06:00:00.000Z')
  })
  it('handles a quiet window ending in the repeated autumn hour', () => {
    const at = new Date('2026-10-25T01:15:00Z')
    const end = quietHoursEnd(
      rules({ quietFromMinutes: 60, quietToMinutes: 150 }),
      at,
    )!
    expect(end.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })
})
