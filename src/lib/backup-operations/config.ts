import { z } from 'zod'

export const backupSchema = z
  .object({
    BACKUP_INSTANCE: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    BACKUP_REPOSITORY: z.string().min(1),
    BACKUP_PASSWORD: z.string().min(16),
    BACKUP_CONFIG_REPOSITORY: z.string().min(1),
    BACKUP_CONFIG_PASSWORD: z.string().min(16),
    BACKUP_CONFIG_PATHS: z.string().min(1),
    BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).max(365).default(7),
    BACKUP_KEEP_WEEKLY: z.coerce.number().int().min(1).max(52).default(4),
    BACKUP_KEEP_MONTHLY: z.coerce.number().int().min(1).max(120).default(6),
    BACKUP_SCHEDULE: z.string().default('0 2 * * *'),
    BACKUP_TIMEZONE: z.string().default('UTC'),
  })
  .superRefine((value, ctx) => {
    if (value.BACKUP_REPOSITORY === value.BACKUP_CONFIG_REPOSITORY)
      ctx.addIssue({
        code: 'custom',
        path: ['BACKUP_CONFIG_REPOSITORY'],
        message: 'Použijte oddělený repozitář pro konfiguraci a klíče.',
      })
    if (value.BACKUP_PASSWORD === value.BACKUP_CONFIG_PASSWORD)
      ctx.addIssue({
        code: 'custom',
        path: ['BACKUP_CONFIG_PASSWORD'],
        message: 'Použijte odlišné heslo od databázových záloh.',
      })
  })
export function backupConfig() {
  const result = backupSchema.safeParse(process.env)
  if (!result.success)
    throw new Error(
      'Konfigurace záloh: ' +
        [
          ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
        ].join(', '),
    )
  return result.data
}
export type BackupKind = 'database' | 'config'
export type BackupConfig = z.infer<typeof backupSchema>
export function resticEnvironment(
  config: BackupConfig,
  kind: BackupKind,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    RESTIC_REPOSITORY:
      kind === 'database'
        ? config.BACKUP_REPOSITORY
        : config.BACKUP_CONFIG_REPOSITORY,
    RESTIC_PASSWORD:
      kind === 'database'
        ? config.BACKUP_PASSWORD
        : config.BACKUP_CONFIG_PASSWORD,
    RESTIC_PASSWORD_FILE: undefined,
    RESTIC_PASSWORD_COMMAND: undefined,
    RESTIC_REPOSITORY_FILE: undefined,
    ...postgresToolEnvironment(process.env.DATABASE_URL!),
  }
}

/** Keep credentials out of argv and preserve common libpq TLS connection settings. */
export function postgresToolEnvironment(value: string): NodeJS.ProcessEnv {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('Neplatná PostgreSQL URL.')
  const env: NodeJS.ProcessEnv = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '10',
  }
  const options: Record<string, string> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    application_name: 'PGAPPNAME',
    options: 'PGOPTIONS',
    channel_binding: 'PGCHANNELBINDING',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    target_session_attrs: 'PGTARGETSESSIONATTRS',
  }
  for (const [name, optionValue] of url.searchParams) {
    const target = options[name]
    if (!target)
      throw new Error(
        'Nepodporovaná volba PostgreSQL URL pro zálohovací nástroje.',
      )
    env[target] = optionValue
  }
  return env
}
