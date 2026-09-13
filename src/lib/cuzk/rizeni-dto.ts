import type { FollowEndReason } from './rizeni-follow'
import type { RizeniSnapshot } from './snapshot'

/** Browser-safe DTO for followed řízení (no DB imports). */
export type TrackedRizeniDto = {
  id: string
  rizeniId: string
  source: 'plomba' | 'manual'
  isPlomba: boolean
  typRizeni: string | null
  poradoveCislo: number | null
  rok: number | null
  kodPracoviste: number | null
  firstSeenAt: string
  detachedAt: string | null
  followUntil: string | null
  followEndedAt: string | null
  followEndedReason: FollowEndReason | null
  detail: RizeniSnapshot | null
  detailFetchedAt: string | null
  lastError: string | null
}
