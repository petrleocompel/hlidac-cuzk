import { diffRizeni, mergeRizeniDetails } from './snapshot'
import type {
  ParcelSnapshot,
  RizeniProgressChange,
  RizeniSnapshot,
} from './snapshot'
import { MAX_FOLLOWED_RIZENI, cuzkPolicy } from './policy'

export type FollowEndReason = 'window' | 'unavailable' | 'user' | 'capacity'

/** One řízení followed independently of the parcel plomby list. */
export type TrackedRizeni = {
  rizeniId: string
  source: 'plomba' | 'manual'
  isPlomba: boolean
  firstSeenAt: Date
  detachedAt: Date | null
  followUntil: Date | null
  followEndedAt: Date | null
  followEndedReason: FollowEndReason | null
  detail: RizeniSnapshot | null
  detailFetchedAt: Date | null
  lastError: string | null
}

export type RizeniFetchOutcome =
  | { status: 'detail'; detail: RizeniSnapshot }
  /** ČÚZK no longer publishes the řízení: a confirmed end, not an outage. */
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export function followDays(): number {
  return cuzkPolicy().CUZK_RIZENI_FOLLOW_DAYS
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000)
}

export function isFollowActive(row: TrackedRizeni): boolean {
  return !row.isPlomba && row.followEndedAt === null
}

/** Baseline for instances whose řízení history only exists in the last snapshot. */
export function trackedFromSnapshot(
  previous: ParcelSnapshot | null,
  now: Date,
): TrackedRizeni[] {
  if (!previous) return []
  return previous.rizeni.map((detail) => ({
    rizeniId: detail.id,
    source: 'plomba' as const,
    isPlomba: true,
    firstSeenAt: now,
    detachedAt: null,
    followUntil: null,
    followEndedAt: null,
    followEndedReason: null,
    detail,
    detailFetchedAt: detail.detailsFetchedAt
      ? new Date(detail.detailsFetchedAt)
      : null,
    lastError: null,
  }))
}

/** DB rows win over snapshot-derived baselines for the same řízení. */
export function mergeTrackedSources(
  stored: TrackedRizeni[],
  seeded: TrackedRizeni[],
): TrackedRizeni[] {
  const byId = new Map(seeded.map((row) => [row.rizeniId, row]))
  for (const row of stored) byId.set(row.rizeniId, row)
  return [...byId.values()]
}

function plannedFollowUntil(
  row: TrackedRizeni,
  detachedAt: Date,
  days: number,
): Date | null {
  if (row.source === 'manual') return null
  return row.followUntil ?? addDays(detachedAt, days)
}

/**
 * Decides which followed řízení still need their own detail request. Plomby are
 * excluded: their detail already comes with the parcel snapshot.
 */
export function planRizeniFollowUp(
  tracked: TrackedRizeni[],
  plombaIds: Set<string>,
  now: Date,
  days = followDays(),
): { fetch: TrackedRizeni[]; ended: Map<string, FollowEndReason> } {
  const ended = new Map<string, FollowEndReason>()
  const candidates: TrackedRizeni[] = []
  for (const row of tracked) {
    if (plombaIds.has(row.rizeniId)) continue
    if (row.followEndedAt) continue
    const detachedAt = row.detachedAt ?? (row.isPlomba ? now : row.firstSeenAt)
    const until = plannedFollowUntil(row, detachedAt, days)
    if (until && until <= now) {
      ended.set(row.rizeniId, 'window')
      continue
    }
    candidates.push(row)
  }
  // Manual follows are explicit user intent; detached plomby compete by recency.
  candidates.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'manual' ? -1 : 1
    const aAt = (a.detachedAt ?? a.firstSeenAt).getTime()
    const bAt = (b.detachedAt ?? b.firstSeenAt).getTime()
    return bAt - aAt
  })
  for (const row of candidates.slice(MAX_FOLLOWED_RIZENI))
    ended.set(row.rizeniId, 'capacity')
  return { fetch: candidates.slice(0, MAX_FOLLOWED_RIZENI), ended }
}

export type ReconcileInput = {
  tracked: TrackedRizeni[]
  plomby: RizeniSnapshot[]
  fetched: Map<string, RizeniFetchOutcome>
  ended: Map<string, FollowEndReason>
  now: Date
  days?: number
}

/**
 * Produces the rows to persist and the progress changes to report. A missing
 * detail keeps the last known values instead of reporting emptied fields.
 */
export function reconcileTrackedRizeni(input: ReconcileInput): {
  rows: TrackedRizeni[]
  changes: RizeniProgressChange[]
} {
  const days = input.days ?? followDays()
  const { now } = input
  const before = new Map(input.tracked.map((row) => [row.rizeniId, row]))
  const plomby = new Map(input.plomby.map((r) => [r.id, r]))
  const ids = [...new Set([...before.keys(), ...plomby.keys()])]
  const rows: TrackedRizeni[] = []
  const changes: RizeniProgressChange[] = []

  for (const id of ids) {
    const previous = before.get(id)
    const plomba = plomby.get(id)

    if (plomba) {
      const detail = mergeRizeniDetails(previous?.detail ?? undefined, plomba)
      rows.push({
        rizeniId: id,
        source: previous?.source ?? 'plomba',
        isPlomba: true,
        firstSeenAt: previous?.firstSeenAt ?? now,
        detachedAt: null,
        followUntil: null,
        followEndedAt: null,
        followEndedReason: null,
        detail,
        detailFetchedAt:
          plomba.detailAvailable === false
            ? (previous?.detailFetchedAt ?? null)
            : now,
        lastError:
          plomba.detailAvailable === false
            ? 'Detail řízení se nepodařilo načíst; zobrazené údaje jsou poslední známé.'
            : null,
      })
      const change = previous?.detail
        ? diffRizeni(previous.detail, detail)
        : null
      if (change) changes.push({ ...change, followed: false })
      continue
    }

    if (!previous) continue

    const detachedAt =
      previous.detachedAt ?? (previous.isPlomba ? now : previous.firstSeenAt)
    const followUntil = plannedFollowUntil(previous, detachedAt, days)
    const base: TrackedRizeni = {
      ...previous,
      isPlomba: false,
      detachedAt:
        previous.source === 'manual' ? previous.detachedAt : detachedAt,
      followUntil,
    }
    const endReason = input.ended.get(id)
    if (endReason) {
      rows.push({
        ...base,
        followEndedAt: previous.followEndedAt ?? now,
        followEndedReason: previous.followEndedReason ?? endReason,
      })
      continue
    }

    const outcome = input.fetched.get(id)
    if (!outcome) {
      rows.push(base)
      continue
    }
    if (outcome.status === 'unavailable') {
      rows.push({
        ...base,
        followEndedAt: now,
        followEndedReason: 'unavailable',
        lastError: null,
      })
      continue
    }
    if (outcome.status === 'error') {
      rows.push({ ...base, lastError: outcome.message })
      continue
    }
    const detail = mergeRizeniDetails(
      previous.detail ?? undefined,
      outcome.detail,
    )
    rows.push({
      ...base,
      detail,
      detailFetchedAt: now,
      lastError: null,
    })
    const change = previous.detail ? diffRizeni(previous.detail, detail) : null
    if (change) changes.push({ ...change, followed: true })
  }

  return { rows, changes }
}
