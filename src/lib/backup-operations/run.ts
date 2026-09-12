import postgres from 'postgres'
import { backupConfig, resticEnvironment } from './config'
import { backupCommand } from './commands'
import type { BackupKind } from './config'

export async function initializeBackupRepository(
  kind: BackupKind,
): Promise<void> {
  const config = backupConfig()
  // Explicit init only. Never interpret a failed network/password check as a new repository.
  await backupCommand('restic', ['init'], resticEnvironment(config, kind))
}

export async function runBackup(kind: BackupKind): Promise<string | null> {
  const config = backupConfig()
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  })
  try {
    const [lock] =
      await client`select pg_try_advisory_lock(1751935334) as acquired`
    if (!lock.acquired) return null
    await client`insert into backup_status (kind, started_at, finished_at, last_error) values (${kind}, clock_timestamp(), null, null) on conflict (kind) do update set started_at = clock_timestamp(), finished_at = null, last_error = null`
    try {
      const env = resticEnvironment(config, kind)
      const common = [
        '--host',
        config.BACKUP_INSTANCE,
        '--tag',
        `hlidac-${kind}`,
      ]
      const source =
        kind === 'database'
          ? [
              '--stdin-filename',
              'database.dump',
              '--stdin-from-command',
              '--',
              'pg_dump',
              '--format=custom',
              '--no-owner',
              '--no-acl',
            ]
          : [
              '--',
              ...config.BACKUP_CONFIG_PATHS.split('\n')
                .map((path) => path.trim())
                .filter(Boolean),
            ]
      const output = await backupCommand(
        'restic',
        ['backup', '--json', ...common, ...source],
        env,
      )
      const summary = output
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as { message_type?: string; snapshot_id?: string },
        )
        .find((line) => line.message_type === 'summary')
      if (
        !summary?.snapshot_id ||
        !/^[0-9a-f]{8,64}$/.test(summary.snapshot_id)
      )
        throw new Error('Úložiště nepotvrdilo identifikátor úplné zálohy.')
      // Retention is scoped to this instance and category; other snapshots are not touched.
      await backupCommand(
        'restic',
        [
          'forget',
          ...common,
          '--group-by',
          'host,tags',
          '--keep-daily',
          String(config.BACKUP_KEEP_DAILY),
          '--keep-weekly',
          String(config.BACKUP_KEEP_WEEKLY),
          '--keep-monthly',
          String(config.BACKUP_KEEP_MONTHLY),
          '--prune',
        ],
        env,
      )
      await client`update backup_status set finished_at = clock_timestamp(), last_successful_at = started_at, snapshot_id = ${summary.snapshot_id}, last_error = null where kind = ${kind}`
      return summary.snapshot_id
    } catch {
      await client`update backup_status set finished_at = clock_timestamp(), last_error = 'Záloha nebo retence selhala. Ověřte úložiště, klíč a dostupnost databáze.' where kind = ${kind}`
      throw new Error(
        `Záloha ${kind} selhala; poslední úspěch zůstává zachovaný.`,
      )
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
