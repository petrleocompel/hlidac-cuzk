import { createServerFn } from '@tanstack/react-start'
import { requireAdmin } from '#/auth/session'
import { getMonitoringStatus } from '#/lib/monitoring/status'

export const getMonitoringAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    return getMonitoringStatus()
  },
)
