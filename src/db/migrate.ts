import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATION_LOCK_ID = 0x686c6964 // 'hlid'

let ready: Promise<void> | null = null

export function ensureDbReady(): Promise<void> {
  ready ??= runMigrations()
  return ready
}

async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const client = postgres(url, { max: 1, onnotice: () => {} })
  const tdb = drizzle(client)
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`
    try {
      await migrate(tdb, { migrationsFolder: './drizzle' })
    } finally {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
