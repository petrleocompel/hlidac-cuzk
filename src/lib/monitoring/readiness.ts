import postgres from 'postgres'
import { readMigrationFiles } from 'drizzle-orm/migrator'

/** Read-only probe with its own bounded connection; never migrates or contacts ČÚZK. */
export async function probeReadiness(
  databaseUrl = process.env.DATABASE_URL,
): Promise<boolean> {
  if (!databaseUrl) return false
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 1,
    connection: { statement_timeout: 2000 },
    onnotice: () => {},
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const expected = readMigrationFiles({ migrationsFolder: './drizzle' }).at(
      -1,
    )
    if (!expected) return false
    const check = async () => {
      const rows =
        await client`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
      if (
        rows.at(0)?.hash !== expected.hash ||
        Number(rows.at(0)?.created_at) !== expected.folderMillis
      )
        return false
      await client`select last_attempt_at, last_successful_check_at, next_check_at, notes, tags from parcel_watches limit 0`
      await client`select heartbeat_at from worker_health limit 0`
      await client`select finished_at from worker_jobs limit 0`
      await client`select id from auth_rate_limit limit 0`
      await client`select id from registration_invitations limit 0`
      await client`select gotify_enabled, gotify_allowed_urls from notification_policy limit 0`
      await client`select last_successful_at from backup_status limit 0`
      await client`select ntfy_enabled, email_enabled from notification_policy limit 0`
      await client`select digest, urgent from notification_deliveries limit 0`
      await client`select use_instance_gotify from user_notification_settings limit 0`
      return true
    }
    return await Promise.race([
      check(),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2500)
      }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    await client.end({ timeout: 1 })
  }
}
