import { getBackupStatus } from '#/lib/backup-operations/status'
import { createServerFn } from '@tanstack/react-start'
import { requireAdmin } from '#/auth/session'
import { getMonitoringStatus } from '#/lib/monitoring/status'

export const getMonitoringAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const [status, backups] = await Promise.all([
      getMonitoringStatus(),
      getBackupStatus(),
    ])
    return { ...status, backups }
  },
)
