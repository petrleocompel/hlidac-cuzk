import { readMigrationFiles } from 'drizzle-orm/migrator'
import { probeReadiness } from '#/lib/monitoring/readiness'
import { getBackupStatus } from '#/lib/backup-operations/status'
import { createServerFn } from '@tanstack/react-start'
import { requireAdmin } from '#/auth/session'
import { getMonitoringStatus } from '#/lib/monitoring/status'

export const getMonitoringAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const [status, backups, schemaReady] = await Promise.all([
      getMonitoringStatus(),
      getBackupStatus(),
      probeReadiness(),
    ])
    return {
      ...status,
      backups,
      release: {
        version: process.env.APP_VERSION || 'development',
        revision: process.env.APP_REVISION || 'unknown',
        schemaReady,
        schema:
          readMigrationFiles({ migrationsFolder: './drizzle' }).length - 1,
      },
    }
  },
)
