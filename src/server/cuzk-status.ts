import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { ensureDbReady } from '#/db/migrate'
import { getCuzkMetrics } from '#/lib/cuzk/metrics'

export type CuzkStatus = {
  limit: number
  remaining: number
  resetsAt: string
  blockedUntil: string | null
  blockedReason: string | null
}

/** Non-admin subset of {@link getCuzkMetrics} — safe to show to any signed-in user. */
export const getCuzkStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CuzkStatus> => {
    await requireSession()
    await ensureDbReady()
    const metrics = await getCuzkMetrics()
    return {
      limit: metrics.limit,
      remaining: metrics.remaining,
      resetsAt: metrics.resetsAt,
      blockedUntil: metrics.blockedUntil,
      blockedReason: metrics.blockedReason,
    }
  },
)
