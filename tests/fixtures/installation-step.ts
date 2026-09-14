/** Disposable installation journey subprocess. Never load an operator's .env. */
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'

assert(
  new URL(process.env.DATABASE_URL!).pathname.startsWith(
    '/hlidac_test_journey_',
  ),
)
assert(new URL(process.env.CUZK_API_BASE_URL!).hostname === '127.0.0.1')
const { db, closeDb } = await import('../../src/db/index.ts')
const { user } = await import('../../src/db/schema.ts')
const base = process.env.BETTER_AUTH_URL!
const email = 'journey@example.test',
  password = 'journey-fixture-long-password'
async function login() {
  const { handleAuthRequest } = await import('../../src/auth/audited.ts')
  const response = await handleAuthRequest(
    new Request(base + '/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  )
  assert.equal(response.status, 200)
}
try {
  const phase = process.argv[2]
  if (phase === 'auth') {
    const { handleAuthRequest } = await import('../../src/auth/audited.ts')
    const denied = await handleAuthRequest(
      new Request(base + '/api/auth/sign-up/email', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'uninvited@example.test',
          name: 'Uninvited',
          password,
        }),
      }),
    )
    assert(denied.status >= 400)
    await login()
    assert.equal((await db.query.user.findMany()).length, 1)
  } else if (phase === 'watch') {
    const owner = await db.query.user.findFirst({
      where: eq(user.email, email),
    })
    assert(owner)
    const { createVerifiedWatch } =
      await import('../../src/lib/cuzk/watch-create.ts')
    const watch = await createVerifiedWatch({
      userId: owner.id,
      isknId: '1',
      label: 'Journey parcel',
      pollIntervalMinutes: 1440,
    })
    const { SettingsInput, updateNotificationSettings } =
      await import('../../src/lib/notifications/settings.ts')
    await updateNotificationSettings(
      owner.id,
      SettingsInput.parse({
        gotifyUrl: process.env.CUZK_API_BASE_URL,
        gotifyToken: { action: 'replace', value: 'journey-fixture-token' },
      }),
    )
    const { changeWatchBatch } =
      await import('../../src/server/organization.server.ts')
    await assert.rejects(() =>
      changeWatchBatch('foreign-owner', { ids: [watch.id], enabled: false }),
    )
    assert.equal((await db.query.parcelWatches.findFirst())?.enabled, true)
  } else if (phase === 'poll') {
    const watch = await db.query.parcelWatches.findFirst()
    assert(watch)
    const { pollWatchById } =
      await import('../../src/cron/jobs/poll-parcels.ts')
    const result = await pollWatchById(watch.id)
    assert.equal(result.queued, 1)
  } else if (phase === 'deliver') {
    const { deliverDueNotifications } =
      await import('../../src/lib/notifications/outbox.ts')
    const result = await deliverDueNotifications()
    assert.equal(result.sent, 1)
    assert.equal(result.failed, 0)
  } else if (phase === 'restored') {
    await login()
    assert.equal((await db.query.watchEvents.findMany()).length, 1)
    const delivery = await db.query.notificationDeliveries.findFirst()
    assert.equal(delivery?.status, 'pending')
    assert.equal(delivery.attemptCount, 0)
    const watch = await db.query.parcelWatches.findFirst()
    assert(watch)
    assert.equal(watch.label, 'Journey parcel')
    assert.equal(watch.lastError, null)
    assert.equal(
      (await db.query.user.findFirst({ where: eq(user.email, email) }))?.role,
      'admin',
    )
  } else throw new Error('Unknown journey phase')
  console.log('PASS installation phase: ' + phase)
} finally {
  await closeDb()
}
