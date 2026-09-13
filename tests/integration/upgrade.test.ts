import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { probeReadiness } from '../../src/lib/monitoring/readiness'

const exec = promisify(execFile)
let client: ReturnType<typeof postgres>
let databaseUrl: string
let directory: string
const env = () => ({
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'production',
  SSO_BOOTSTRAP_ENABLED: 'false',
  SEED_DEMO_WATCH: '0',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: '',
})
beforeAll(async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  })
  const name = `hlidac_test_upgrade_${process.pid}`
  await admin.unsafe(`CREATE DATABASE ${name}`)
  const url = new URL(process.env.TEST_DATABASE_URL!)
  url.pathname = '/' + name
  databaseUrl = url.toString()
  await admin.end()
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  // Schema shipped by d63f2c9, before backup-status migration 0009.
  directory = await mkdtemp(join(tmpdir(), 'hlidac-upgrade-'))
  await mkdir(join(directory, 'meta'))
  const journal = JSON.parse(
    await readFile('drizzle/meta/_journal.json', 'utf8'),
  )
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= 8,
  )
  await writeFile(
    join(directory, 'meta/_journal.json'),
    JSON.stringify(journal),
  )
  for (const entry of journal.entries)
    await copyFile(
      `drizzle/${entry.tag}.sql`,
      join(directory, `${entry.tag}.sql`),
    )
  await migrate(drizzle(client), { migrationsFolder: directory })
  await client`insert into "user" (id, name, email, role) values ('upgrade-owner', 'Owner', 'upgrade@example.test', 'admin')`
  await client`insert into account (id, account_id, provider_id, user_id, password, updated_at) values ('upgrade-account', 'upgrade-owner', 'credential', 'upgrade-owner', 'fixture-password-hash', now())`
  const [watch] =
    await client`insert into parcel_watches (user_id, label, ku_code, ku_name, parcel_number, iskn_id, last_snapshot_json) values ('upgrade-owner', 'Preserved', '777552', 'Fixture', 1, '1', '{"version":1,"vymera":100}') returning id`
  const [event] =
    await client`insert into watch_events (watch_id, kind, payload_json) values (${watch.id}, 'parcel_changed', '{"before":100,"after":101}') returning id`
  await client`insert into notification_deliveries (event_id, channel, title, message) values (${event.id}, 'gotify', 'Preserved', 'Pending fixture')`
})
afterAll(async () => {
  await client.end()
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
  await admin.unsafe(
    `DROP DATABASE ${new URL(databaseUrl).pathname.slice(1)} WITH (FORCE)`,
  )
  await admin.end()
  await rm(directory, { recursive: true, force: true })
})
it('blocks web and worker after a failed migration, then upgrades the previous schema without losing data', async () => {
  const tables = [
    'user',
    'account',
    'parcel_watches',
    'watch_events',
    'notification_deliveries',
  ]
  // Compare the columns the old schema had: an upgrade may add columns, but it
  // must not change or drop existing data.
  const legacyColumns = new Map(
    await Promise.all(
      tables.map(
        async (table) =>
          [
            table,
            (
              await client`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by column_name`
            ).map((row) => row.column_name as string),
          ] as const,
      ),
    ),
  )
  const snapshot = async () =>
    Promise.all(
      tables.map((table) =>
        client.unsafe(
          `select ${legacyColumns
            .get(table)!
            .map((column) => `"${column}"`)
            .join(', ')} from "${table}" order by id`,
        ),
      ),
    )
  const before = await snapshot()
  await client`create table backup_status (fixture_collision boolean)`
  await expect(
    exec('pnpm', ['bootstrap'], { env: env(), timeout: 20_000 }),
  ).rejects.toBeDefined()
  expect(await probeReadiness(databaseUrl)).toBe(false)
  await expect(
    exec('pnpm', ['start'], { env: env(), timeout: 15_000 }),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining('nejsou připravené'),
  })
  await expect(
    exec('pnpm', ['cron', '--once', 'poll-parcels'], {
      env: env(),
      timeout: 15_000,
    }),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining('Schéma není připravené'),
  })
  expect(await snapshot()).toEqual(before)
  await client`drop table backup_status`
  await exec('pnpm', ['bootstrap'], { env: env(), timeout: 20_000 })
  expect(await probeReadiness(databaseUrl)).toBe(true)
  expect(await snapshot()).toEqual(before)
  await exec('pnpm', ['bootstrap'], { env: env(), timeout: 20_000 })
  expect(await snapshot()).toEqual(before)
  expect(await client`select * from cuzk_api_requests`).toHaveLength(0)
})
it('rejects a database newer than the running image without changing it', async () => {
  await client`insert into drizzle.__drizzle_migrations (hash, created_at) values ('future-fixture', 9999999999999)`
  expect(await probeReadiness(databaseUrl)).toBe(false)
  await client`delete from drizzle.__drizzle_migrations where hash = 'future-fixture'`
  expect(await probeReadiness(databaseUrl)).toBe(true)
})
