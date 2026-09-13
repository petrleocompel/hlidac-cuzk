import '@tanstack/react-start/server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const globalForDb = globalThis as unknown as {
  __hlidacPg?: ReturnType<typeof postgres>
}

function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  return postgres(url, { max: 10 })
}

const client = globalForDb.__hlidacPg ?? createClient()
if (process.env.NODE_ENV !== 'production') {
  globalForDb.__hlidacPg = client
}

export const db = drizzle(client, { schema })

/** Close the underlying postgres.js pool (needed for one-shot CLI scripts). */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 })
  globalForDb.__hlidacPg = undefined
}
