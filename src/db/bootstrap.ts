import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { getEnv } from '#/env'
import { db } from './index'
import { user } from './schema'
import { runMigrations } from './migrate'
import { seedAdmin } from './seed-admin'
import { bootstrapSsoFromEnv } from './bootstrap-sso'

export async function bootstrapInstance(): Promise<void> {
  const config = getEnv()
  process.env.BETTER_AUTH_URL = config.BETTER_AUTH_URL
  const lock = postgres(config.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  })
  try {
    await lock`select pg_advisory_lock(1751935333)`
    await runMigrations()
    const existing = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'admin'))
      .limit(1)
    // Redeploy already has an admin; first install must create one before SSO.
    const hadAdmin = existing.length > 0
    if (!hadAdmin || (config.ADMIN_EMAIL && config.ADMIN_PASSWORD)) {
      if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD)
        throw new Error(
          'První bootstrap vyžaduje ADMIN_EMAIL a ADMIN_PASSWORD (alespoň 12 znaků).',
        )
      await seedAdmin({
        email: String(config.ADMIN_EMAIL),
        password: String(config.ADMIN_PASSWORD),
        name: config.ADMIN_NAME,
      })
    }
    try {
      await bootstrapSsoFromEnv()
    } catch (error) {
      // Optional SSO must not block schema/admin upgrades when the instance
      // already exists (IdP discovery can be unreachable from migrate network).
      if (!hadAdmin) throw error
      const detail =
        error instanceof Error ? error.message : 'neznámá chyba SSO bootstrapu'
      console.warn(
        `[sso-bootstrap] přeskočeno při opakovaném bootstrapu: ${detail}`,
      )
    }
    if (config.SEED_DEMO_WATCH === '1') {
      const { seedDemoWatch } = await import('./seed-demo-watch')
      const [admin] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.role, 'admin'))
        .limit(1)
      await seedDemoWatch(admin.id)
    }
    console.log(
      'Bootstrap dokončen: schéma, správce a volitelné SSO jsou připravené.',
    )
  } finally {
    // Closing releases the session lock even after a failed bootstrap.
    await lock.end({ timeout: 5 })
  }
}
