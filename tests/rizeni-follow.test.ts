import { describe, expect, it } from 'vitest'
import {
  diffRizeni,
  mergeRizeniDetails,
  normalizeRizeni,
  parseRizeniSnapshot,
  stavUhradyLabel,
} from '../src/lib/cuzk/snapshot'
import type { RizeniSnapshot } from '../src/lib/cuzk/snapshot'
import type { RizeniDef } from '../src/lib/cuzk/client'
import {
  mergeTrackedSources,
  planRizeniFollowUp,
  reconcileTrackedRizeni,
  trackedFromSnapshot,
} from '../src/lib/cuzk/rizeni-follow'
import type { TrackedRizeni } from '../src/lib/cuzk/rizeni-follow'

const NOW = new Date('2026-09-12T10:00:00.000Z')

function detail(overrides: Partial<RizeniDef> = {}): RizeniSnapshot {
  return normalizeRizeni(
    {
      id: 700,
      typRizeni: 'V',
      poradoveCislo: 4310,
      rok: 2026,
      kodPracoviste: 407,
      stav: 'Probíhá řízení',
      stavUhrady: 'N',
      provedeneOperace: [{ nazev: 'Přijetí návrhu' }],
      ...overrides,
    },
    NOW,
  )
}

function tracked(overrides: Partial<TrackedRizeni> = {}): TrackedRizeni {
  return {
    rizeniId: '700',
    source: 'plomba',
    isPlomba: true,
    firstSeenAt: NOW,
    detachedAt: null,
    followUntil: null,
    followEndedAt: null,
    followEndedReason: null,
    detail: detail(),
    detailFetchedAt: NOW,
    lastError: null,
    ...overrides,
  }
}

describe('rizeni detail diff', () => {
  it('reports a state change on the same rizeni id', () => {
    const change = diffRizeni(
      detail(),
      detail({ stav: 'Vklad povolen, zapsáno' }),
    )
    expect(change?.fields).toEqual(['stav'])
    expect(change?.previous.stav).toBe('Probíhá řízení')
    expect(change?.next.stav).toBe('Vklad povolen, zapsáno')
  })

  it('reports new operations once and ignores repeated ones', () => {
    const next = detail({
      provedeneOperace: [
        { nazev: 'Přijetí návrhu', datumProvedeni: undefined },
        { nazev: 'Vklad proveden', datumProvedeni: '2026-09-12T08:00:00Z' },
        { nazev: 'Vklad proveden', datumProvedeni: '2026-09-12T08:00:00Z' },
      ],
    })
    const change = diffRizeni(detail(), next)
    expect(change?.addedOperations.map((op) => op.nazev)).toEqual([
      'Vklad proveden',
    ])
  })

  it('never reports an unavailable detail as emptied fields', () => {
    const unavailable = normalizeRizeni(
      { id: 700, typRizeni: 'V', poradoveCislo: 4310, rok: 2026 },
      NOW,
    )
    const merged = mergeRizeniDetails(detail(), unavailable)
    expect(merged.stav).toBe('Probíhá řízení')
    expect(merged.stavUhrady).toBe('N')
    expect(merged.provedeneOperace).toHaveLength(1)
    expect(diffRizeni(detail(), merged)).toBeNull()
  })

  it('labels payment codes and keeps an unknown state unknown', () => {
    expect(stavUhradyLabel('U')).toBe('uhrazeno')
    expect(stavUhradyLabel(null)).toBe('neznámý stav úhrady')
    expect(stavUhradyLabel('X')).toBe('X')
  })

  it('reads a stored detail back without inventing values', () => {
    const parsed = parseRizeniSnapshot(JSON.parse(JSON.stringify(detail())))
    expect(parsed?.stav).toBe('Probíhá řízení')
    expect(parseRizeniSnapshot({ nope: true })).toBeNull()
  })
})

describe('follow-up planning', () => {
  it('does not query plomby separately', () => {
    const plan = planRizeniFollowUp([tracked()], new Set(['700']), NOW, 14)
    expect(plan.fetch).toEqual([])
    expect(plan.ended.size).toBe(0)
  })

  it('keeps querying a řízení that just lost its plomba', () => {
    const plan = planRizeniFollowUp([tracked()], new Set(), NOW, 14)
    expect(plan.fetch.map((row) => row.rizeniId)).toEqual(['700'])
    expect(plan.ended.size).toBe(0)
  })

  it('stops querying after the configured window', () => {
    const detached = tracked({
      isPlomba: false,
      detachedAt: new Date('2026-08-01T10:00:00.000Z'),
      followUntil: new Date('2026-08-15T10:00:00.000Z'),
    })
    const plan = planRizeniFollowUp([detached], new Set(), NOW, 14)
    expect(plan.fetch).toEqual([])
    expect(plan.ended.get('700')).toBe('window')
  })

  it('follows a manually added řízení without a deadline', () => {
    const manual = tracked({
      rizeniId: '900',
      source: 'manual',
      isPlomba: false,
      detachedAt: null,
      firstSeenAt: new Date('2026-01-01T10:00:00.000Z'),
    })
    const plan = planRizeniFollowUp([manual], new Set(), NOW, 14)
    expect(plan.fetch.map((row) => row.rizeniId)).toEqual(['900'])
  })

  it('caps the number of simultaneous follows', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      tracked({
        rizeniId: String(800 + i),
        isPlomba: false,
        detachedAt: new Date(NOW.getTime() - i * 60_000),
        followUntil: new Date(NOW.getTime() + 86_400_000),
      }),
    )
    const plan = planRizeniFollowUp(rows, new Set(), NOW, 14)
    expect(plan.fetch).toHaveLength(10)
    expect([...plan.ended.values()]).toEqual(['capacity', 'capacity'])
    // The two oldest detachments are the ones dropped.
    expect([...plan.ended.keys()].sort()).toEqual(['810', '811'])
  })
})

describe('reconciling tracked rizeni', () => {
  const later = new Date(NOW.getTime() + 86_400_000)

  it('marks a removed plomba as followed and reports its progress', () => {
    const result = reconcileTrackedRizeni({
      tracked: [tracked()],
      plomby: [],
      fetched: new Map([
        [
          '700',
          {
            status: 'detail' as const,
            detail: detail({ stav: 'Vklad povolen' }),
          },
        ],
      ]),
      ended: new Map(),
      now: later,
      days: 14,
    })
    const row = result.rows[0]
    expect(row.isPlomba).toBe(false)
    expect(row.detachedAt).toEqual(later)
    expect(row.followUntil).toEqual(new Date(later.getTime() + 14 * 86_400_000))
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].followed).toBe(true)
    expect(result.changes[0].next.stav).toBe('Vklad povolen')
  })

  it('ends the follow when ČÚZK no longer publishes the řízení', () => {
    const result = reconcileTrackedRizeni({
      tracked: [tracked({ isPlomba: false, detachedAt: NOW })],
      plomby: [],
      fetched: new Map([['700', { status: 'unavailable' as const }]]),
      ended: new Map(),
      now: later,
      days: 14,
    })
    expect(result.rows[0].followEndedReason).toBe('unavailable')
    expect(result.rows[0].detail?.stav).toBe('Probíhá řízení')
    expect(result.changes).toEqual([])
  })

  it('keeps following and records a transient detail failure', () => {
    const result = reconcileTrackedRizeni({
      tracked: [tracked({ isPlomba: false, detachedAt: NOW })],
      plomby: [],
      fetched: new Map([
        ['700', { status: 'error' as const, message: 'ČÚZK neodpovědělo.' }],
      ]),
      ended: new Map(),
      now: later,
      days: 14,
    })
    expect(result.rows[0].followEndedAt).toBeNull()
    expect(result.rows[0].lastError).toBe('ČÚZK neodpovědělo.')
    expect(result.rows[0].detail?.stav).toBe('Probíhá řízení')
  })

  it('does not report progress for a first-seen plomba', () => {
    const result = reconcileTrackedRizeni({
      tracked: [],
      plomby: [detail()],
      fetched: new Map(),
      ended: new Map(),
      now: NOW,
      days: 14,
    })
    expect(result.changes).toEqual([])
    expect(result.rows[0].isPlomba).toBe(true)
    expect(result.rows[0].firstSeenAt).toEqual(NOW)
  })

  it('resets the follow when the řízení becomes a plomba again', () => {
    const result = reconcileTrackedRizeni({
      tracked: [
        tracked({
          isPlomba: false,
          detachedAt: NOW,
          followUntil: later,
          followEndedAt: NOW,
          followEndedReason: 'window',
        }),
      ],
      plomby: [detail()],
      fetched: new Map(),
      ended: new Map(),
      now: later,
      days: 14,
    })
    expect(result.rows[0]).toMatchObject({
      isPlomba: true,
      detachedAt: null,
      followUntil: null,
      followEndedAt: null,
      followEndedReason: null,
    })
  })

  it('survives a detail outage on a plomba without emitting a change', () => {
    const blank = normalizeRizeni(
      { id: 700, typRizeni: 'V', poradoveCislo: 4310, rok: 2026 },
      later,
    )
    const result = reconcileTrackedRizeni({
      tracked: [tracked()],
      plomby: [{ ...blank, detailAvailable: false, availableFields: [] }],
      fetched: new Map(),
      ended: new Map(),
      now: later,
      days: 14,
    })
    expect(result.changes).toEqual([])
    expect(result.rows[0].detail?.stav).toBe('Probíhá řízení')
    expect(result.rows[0].lastError).toMatch(/poslední známé/)
  })
})

describe('tracked sources', () => {
  it('seeds missing rows from the last snapshot and prefers stored rows', () => {
    // Any stored snapshot shape works: only its plomby matter for seeding.
    const seeded = trackedFromSnapshot(
      { rizeni: [detail(), detail({ id: 701 })] },
      NOW,
    )
    expect(seeded.map((row) => row.rizeniId)).toEqual(['700', '701'])
    const stored = tracked({ lastError: 'stored' })
    const merged = mergeTrackedSources([stored], seeded)
    expect(merged).toHaveLength(2)
    expect(merged.find((row) => row.rizeniId === '700')?.lastError).toBe(
      'stored',
    )
  })
})
