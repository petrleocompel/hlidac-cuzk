import { createServerFn } from '@tanstack/react-start'
import { requireAdmin } from '#/auth/session'
import { ensureDbReady } from '#/db/migrate'
import { getCuzkMetrics } from '#/lib/cuzk/metrics'
import { refreshCuzkAccount } from '#/lib/cuzk/http'

export const getCuzkMetricsAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    await ensureDbReady()
    return getCuzkMetrics()
  },
)

export const refreshCuzkAccountAdmin = createServerFn({
  method: 'POST',
}).handler(async () => {
  await requireAdmin()
  await ensureDbReady()
  return refreshCuzkAccount()
})
