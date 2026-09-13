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

let client: ReturnType<typeof postgres>
let databaseUrl: string
let directory: string

/** Migrations up to `maxIdx`, copied into a temporary folder. */
async function migrateUpTo(maxIdx: number) {
  const journal = JSON.parse(
    await readFile('drizzle/meta/_journal.json', 'utf8'),
  )
  const entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx <= maxIdx,
  )
  await rm(directory, { recursive: true, force: true })
  await mkdir(join(directory, 'meta'), { recursive: true })
  await writeFile(
    join(directory, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries }),
  )
  for (const entry of entries)
    await copyFile(
      `drizzle/${entry.tag}.sql`,
      join(directory, `${entry.tag}.sql`),
    )
  await migrate(drizzle(client), { migrationsFolder: directory })
}

beforeAll(async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  })
  const name = `hlidac_test_dedupe_${process.pid}`
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${name}`)
  const url = new URL(process.env.TEST_DATABASE_URL!)
  url.pathname = '/' + name
  databaseUrl = url.toString()
  await admin.end()
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  directory = await mkdtemp(join(tmpdir(), 'hlidac-dedupe-'))
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

it('keeps the richest duplicate watch and then enforces one watch per object', async () => {
  // Schema before the uniqueness migration, where duplicates were possible.
  await migrateUpTo(11)
  await client`insert into "user" (id, name, email) values ('dedupe-owner', 'Owner', 'dedupe@example.test')`
  await client`insert into "user" (id, name, email) values ('other-owner', 'Other', 'other@example.test')`
  const insert = async (
    userId: string,
    label: string,
    isknId: string,
    createdAt: string,
  ) => {
    const [row] = await client`insert into parcel_watches
      (user_id, label, ku_code, ku_name, parcel_number, iskn_id, created_at)
      values (${userId}, ${label}, '777552', 'Fixture', 1, ${isknId}, ${createdAt})
      returning id`
    return row.id as string
  }
  const oldest = await insert(
    'dedupe-owner',
    'Oldest without history',
    '1',
    '2026-01-01T00:00:00Z',
  )
  const withHistory = await insert(
    'dedupe-owner',
    'Duplicate with history',
    '1',
    '2026-02-01T00:00:00Z',
  )
  const otherObject = await insert(
    'dedupe-owner',
    'Different parcel',
    '2',
    '2026-02-01T00:00:00Z',
  )
  // The same object watched by another user must survive untouched.
  const otherUser = await insert(
    'other-owner',
    'Same parcel, other user',
    '1',
    '2026-02-01T00:00:00Z',
  )
  await client`insert into watch_events (watch_id, kind, payload_json) values (${withHistory}, 'parcel_attrs', '{"fields":["vymera"]}')`

  // A shorter history on the discarded row must also survive, including jobs.
  const [olderEvent] =
    await client`insert into watch_events (watch_id, kind, payload_json) values (${oldest}, 'lv_change', '{}') returning id`
  await client`insert into notification_deliveries (event_id, channel, title, message) values (${olderEvent.id}, 'gotify', 'Fixture', 'Pending fixture')`
  await client`insert into watch_events (watch_id, kind, payload_json) values (${withHistory}, 'new_rizeni', '{}')`
  await client`insert into watch_rizeni (watch_id, rizeni_id) values (${oldest}, 'unique-old'), (${oldest}, 'shared'), (${withHistory}, 'shared')`

  await migrateUpTo(99)

  const rows = await client`select id, label from parcel_watches order by label`
  expect(rows.map((row) => row.label)).toEqual([
    'Different parcel',
    'Duplicate with history',
    'Same parcel, other user',
  ])
  expect((rows.map((row) => row.id) as string[]).sort()).toEqual(
    [withHistory, otherObject, otherUser].sort(),
  )
  expect(rows.map((row) => row.id)).not.toContain(oldest)
  // The preserved row keeps its history.
  expect(
    await client`select count(*)::int as total from watch_events where watch_id = ${withHistory}`,
  ).toMatchObject([{ total: 3 }])
  expect(
    await client`select status, event_id from notification_deliveries`,
  ).toMatchObject([{ status: 'pending', event_id: olderEvent.id }])
  expect(
    await client`select watch_id, rizeni_id from watch_rizeni order by rizeni_id`,
  ).toEqual([
    { watch_id: withHistory, rizeni_id: 'shared' },
    { watch_id: withHistory, rizeni_id: 'unique-old' },
  ])
  await expect(
    insert('dedupe-owner', 'Now rejected', '1', '2026-03-01T00:00:00Z'),
  ).rejects.toMatchObject({ code: '23505' })
})
