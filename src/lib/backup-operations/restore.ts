import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import postgres from 'postgres'
import {
  backupConfig,
  resticEnvironment,
  postgresToolEnvironment,
} from './config'
import { backupCommand } from './commands'

/** Restore only into an empty DB. Never drops or cleans existing user objects. */
export async function restoreDatabase(snapshot: string): Promise<void> {
  if (!/^[0-9a-f]{8,64}$/.test(snapshot))
    throw new Error('Vyberte konkrétní snapshot ID z databázového repozitáře.')
  const target = process.env.RESTORE_DATABASE_URL
  if (!target)
    throw new Error(
      'RESTORE_DATABASE_URL musí ukazovat na prázdnou cílovou databázi.',
    )
  const config = backupConfig()
  const client = postgres(target, { max: 1, connect_timeout: 10 })
  let directory: string | undefined
  try {
    const objects =
      await client`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' limit 1`
    const routines =
      await client`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema') limit 1`
    if (objects.length || routines.length)
      throw new Error('Cílová databáze není prázdná; obnova byla odmítnuta.')
    directory = await mkdtemp(join(tmpdir(), 'hlidac-restore-'))
    const filename = join(directory, 'database.dump')
    const file = await open(filename, 'wx', 0o600)
    const env = resticEnvironment(config, 'database')
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('restic', ['dump', snapshot, '/database.dump'], {
          env,
          stdio: ['ignore', file.fd, 'ignore'],
          timeout: 90 * 60_000,
        })
        child.on('error', () => reject(new Error('Stažení zálohy selhalo.')))
        child.on('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('Stažení nebo ověření zálohy selhalo.')),
        )
      })
    } finally {
      await file.close()
    }
    const targetEnv = postgresToolEnvironment(target)
    await backupCommand(
      'pg_restore',
      [
        '--dbname',
        targetEnv.PGDATABASE!,
        '--no-owner',
        '--no-acl',
        '--single-transaction',
        '--exit-on-error',
        filename,
      ],
      { ...env, ...targetEnv },
    )
    // Leave restored jobs intact; operator verifies the instance before starting the worker.
    console.log(
      'Obnova dokončena. Worker nebyl spuštěn; zkontrolujte konfiguraci, klíče a pnpm run doctor.',
    )
  } finally {
    await client.end({ timeout: 5 })
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
