import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import * as schema from '../../src/db/schema'
import {
  initializeBackupRepository,
  runBackup,
} from '../../src/lib/backup-operations/run'
import { restoreDatabase } from '../../src/lib/backup-operations/restore'
import {
  backupConfig,
  resticEnvironment,
} from '../../src/lib/backup-operations/config'
import { backupCommand } from '../../src/lib/backup-operations/commands'
import {
  encryptNotificationSecret,
  decryptNotificationSecret,
} from '../../src/lib/notifications/secrets'

let directory: string
let source: ReturnType<typeof postgres>
let target: ReturnType<typeof postgres>
let admin: ReturnType<typeof postgres>
let sourceName: string
let targetName: string
let snapshot: string
const password = 'restore-fixture-long-password'
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hlidac-backup-test-'))
  admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
  sourceName = `hlidac_test_backup_${process.pid}`
  targetName = `hlidac_test_restore_${process.pid}`
  await admin.unsafe(`CREATE DATABASE ${sourceName}`)
  await admin.unsafe(`CREATE DATABASE ${targetName}`)
  const url = new URL(process.env.TEST_DATABASE_URL!)
  url.pathname = '/' + sourceName
  process.env.DATABASE_URL = url.toString()
  source = postgres(url.toString(), { max: 1, onnotice: () => {} })
  url.pathname = '/' + targetName
  process.env.RESTORE_DATABASE_URL = url.toString()
  target = postgres(url.toString(), { max: 1 })
  const database = drizzle(source, { schema })
  await migrate(database, { migrationsFolder: './drizzle' })
  process.env.BACKUP_INSTANCE = 'restore-fixture'
  process.env.BACKUP_REPOSITORY = join(directory, 'db-repository')
  process.env.BACKUP_CONFIG_REPOSITORY = join(directory, 'config-repository')
  process.env.BACKUP_PASSWORD = 'database-fixture-repository-password'
  process.env.BACKUP_CONFIG_PASSWORD =
    'configuration-fixture-repository-password'
  process.env.BACKUP_CONFIG_PATHS = join(directory, 'app.env')
  await writeFile(
    process.env.BACKUP_CONFIG_PATHS,
    'NOTIFICATION_ENCRYPTION_KEY=' + process.env.NOTIFICATION_ENCRYPTION_KEY,
    { mode: 0o600 },
  )
  await database.insert(schema.user).values({
    id: 'owner',
    name: 'Restore owner',
    email: 'restore@example.test',
    role: 'admin',
  })
  await database.insert(schema.account).values({
    id: 'credential',
    userId: 'owner',
    accountId: 'owner',
    providerId: 'credential',
    password: await hashPassword(password),
  })
  await database.insert(schema.ssoProvider).values({
    id: 'provider',
    providerId: 'fixture',
    issuer: 'https://idp.example.test',
    domain: '*',
    userId: 'owner',
    oidcConfig: JSON.stringify({ clientSecret: 'sso-backup-marker' }),
  })
  const [watch] = await database
    .insert(schema.parcelWatches)
    .values({
      userId: 'owner',
      label: 'Restored parcel',
      kuCode: '777552',
      kuName: 'Fixture',
      parcelNumber: 1,
      isknId: '1',
      lastSnapshotJson: { parcel: { vymera: 100 } },
    })
    .returning()
  const [event] = await database
    .insert(schema.watchEvents)
    .values({
      watchId: watch.id,
      kind: 'parcel_attrs',
      payloadJson: { fields: ['vymera'] },
    })
    .returning()
  await database.insert(schema.notificationDeliveries).values({
    eventId: event.id,
    channel: 'gotify',
    title: 'Fixture',
    message: 'Awaiting delivery',
    status: 'pending',
  })
  await database.insert(schema.userNotificationSettings).values({
    userId: 'owner',
    gotifyUrl: 'http://gotify.invalid',
    gotifyToken: encryptNotificationSecret(
      'notification-backup-marker',
      'owner',
      'gotifyToken',
    ),
  })
  await initializeBackupRepository('database')
  await initializeBackupRepository('config')
})
afterAll(async () => {
  await source.end()
  await target.end()
  await admin.unsafe(`DROP DATABASE ${sourceName} WITH (FORCE)`)
  await admin.unsafe(`DROP DATABASE ${targetName} WITH (FORCE)`)
  await admin.end()
  await rm(directory, { recursive: true, force: true })
})

describe('real PostgreSQL dump, restic encryption and restore', () => {
  it('backs up DB and configuration to separate encrypted repositories and records success', async () => {
    snapshot = (await runBackup('database'))!
    expect(snapshot).toMatch(/^[a-f0-9]{8,64}$/)
    const configSnapshot = await runBackup('config')
    expect(configSnapshot).toMatch(/^[a-f0-9]{8,64}$/)
    const restoredConfig = await backupCommand(
      'restic',
      ['dump', configSnapshot!, process.env.BACKUP_CONFIG_PATHS!],
      resticEnvironment(backupConfig(), 'config'),
    )
    expect(restoredConfig).toBe(
      await readFile(process.env.BACKUP_CONFIG_PATHS!, 'utf8'),
    )
    const statuses = await source`select * from backup_status order by kind`
    expect(statuses).toHaveLength(2)
    expect(
      statuses.every((row) => row.last_successful_at && !row.last_error),
    ).toBe(true)
    await backupCommand(
      'restic',
      ['check', '--read-data'],
      resticEnvironment(backupConfig(), 'database'),
    )
    const filenames = await readdir(process.env.BACKUP_REPOSITORY!, {
      recursive: true,
    })
    for (const name of filenames) {
      try {
        expect(
          (await readFile(join(process.env.BACKUP_REPOSITORY!, name))).includes(
            Buffer.from('sso-backup-marker'),
          ),
        ).toBe(false)
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'EISDIR'
        ))
          throw error
      }
    }
  })
  it('restores accounts, SSO, watches, history and pending deliveries without starting the worker', async () => {
    const started = Date.now()
    await restoreDatabase(snapshot)
    const [credential] =
      await target`select password from account where id = 'credential'`
    expect(await verifyPassword({ hash: credential.password, password })).toBe(
      true,
    )
    expect(
      (await target`select role from "user" where id = 'owner'`)[0].role,
    ).toBe('admin')
    expect(
      JSON.parse(
        (await target`select oidc_config from sso_provider`)[0].oidc_config,
      ).clientSecret,
    ).toBe('sso-backup-marker')
    expect(
      (await target`select last_snapshot_json from parcel_watches`)[0]
        .last_snapshot_json,
    ).toMatchObject({ parcel: { vymera: 100 } })
    expect(await target`select id from watch_events`).toHaveLength(1)
    expect(
      (
        await target`select status, attempt_count from notification_deliveries`
      )[0],
    ).toMatchObject({ status: 'pending', attempt_count: 0 })
    const [settings] =
      await target`select gotify_token from user_notification_settings`
    expect(
      decryptNotificationSecret(settings.gotify_token, 'owner', 'gotifyToken'),
    ).toBe('notification-backup-marker')
    expect(await target`select id from cuzk_api_requests`).toHaveLength(0)
    expect(Date.now() - started).toBeLessThan(120_000)
    await expect(restoreDatabase(snapshot)).rejects.toThrow('není prázdná')
  })
  it('does not create a snapshot when the dump command fails', async () => {
    const environment = resticEnvironment(backupConfig(), 'database')
    const before = JSON.parse(
      await backupCommand('restic', ['snapshots', '--json'], environment),
    )
    await expect(
      backupCommand(
        'restic',
        [
          'backup',
          '--stdin-from-command',
          '--stdin-filename',
          'database.dump',
          '--',
          'pg_dump',
          '--table',
          'this_table_does_not_exist',
        ],
        environment,
      ),
    ).rejects.toThrow('selhal')
    const after = JSON.parse(
      await backupCommand('restic', ['snapshots', '--json'], environment),
    )
    expect(after).toHaveLength(before.length)
  })
  it('does not advance the last success after a failed upload and does not prune other instances', async () => {
    const [before] =
      await source`select last_successful_at from backup_status where kind = 'database'`
    const config = backupConfig()
    const environment = resticEnvironment(config, 'database')
    await backupCommand(
      'restic',
      [
        'backup',
        '--host',
        'another-instance',
        '--tag',
        'hlidac-database',
        '--',
        process.env.BACKUP_CONFIG_PATHS!,
      ],
      environment,
    )
    await runBackup('database')
    const other = JSON.parse(
      await backupCommand(
        'restic',
        ['snapshots', '--json', '--host', 'another-instance'],
        environment,
      ),
    )
    expect(other).toHaveLength(1)
    const [success] =
      await source`select last_successful_at from backup_status where kind = 'database'`
    expect(success.last_successful_at >= before.last_successful_at).toBe(true)
    process.env.BACKUP_PASSWORD = 'incorrect-fixture-password'
    await expect(runBackup('database')).rejects.toThrow('selhala')
    const [failed] =
      await source`select last_successful_at, last_error from backup_status where kind = 'database'`
    expect(failed.last_successful_at).toEqual(success.last_successful_at)
    expect(failed.last_error).toBeTruthy()
    process.env.BACKUP_PASSWORD = config.BACKUP_PASSWORD
  })
})
