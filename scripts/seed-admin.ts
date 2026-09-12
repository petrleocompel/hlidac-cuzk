/**
 * Bootstrap an admin user (+ optional demo parcel watch):
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_NAME=… pnpm db:seed-admin
 */
import { MIN_PASSWORD_LENGTH } from '../src/auth/policy.ts'
import { ensureDbReady } from '../src/db/migrate.ts'
import { seedAdmin } from '../src/db/seed-admin.ts'
import { seedDemoWatch } from '../src/db/seed-demo-watch.ts'

const MIN_PASSWORD = MIN_PASSWORD_LENGTH

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim()
  const password = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME?.trim() || undefined
  const seedWatch = process.env.SEED_DEMO_WATCH === '1'

  if (!email) fail('ADMIN_EMAIL is required')
  if (!password) fail('ADMIN_PASSWORD is required')
  if (password.length < MIN_PASSWORD) {
    fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters`)
  }

  await ensureDbReady()
  const result = await seedAdmin({
    email,
    password,
    name,
    resetPassword: process.argv.includes('--reset-password'),
  })

  switch (result.status) {
    case 'password-reset':
      console.log(
        '[seed-admin] admin password reset; existing sessions revoked',
      )
      break
    case 'created':
      console.log(`[seed-admin] created admin user ${email} (${result.userId})`)
      break
    case 'promoted':
      console.log(
        `[seed-admin] promoted existing user ${email} to admin (${result.userId})`,
      )
      break
    case 'already-admin':
      console.log(
        `[seed-admin] ${email} is already an admin (${result.userId}) — nothing to do`,
      )
      break
  }

  if (seedWatch && process.env.CUZK_API_KEY) {
    const watch = await seedDemoWatch(result.userId)
    console.log(
      `[seed-admin] demo watch ${watch.status}: ${watch.watchId} iskn=${watch.isknId}`,
    )
  }
}

function fail(message: string): never {
  console.error(`[seed-admin] ${message}`)
  process.exit(1)
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[seed-admin] failed', err)
    process.exit(1)
  },
)
