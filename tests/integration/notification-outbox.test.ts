import type * as NotificationTransport from '../../src/lib/notifications/http'
import { encryptNotificationSecret } from '../../src/lib/notifications/secrets'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { and, eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  notificationDeliveries,
  notificationPolicy,
  parcelWatches,
  user,
  userNotificationSettings,
  watchEvents,
} from '../../src/db/schema'
import { pollDueWatches, pollWatchById } from '../../src/cron/jobs/poll-parcels'
import { buildParcelSnapshot } from '../../src/lib/cuzk/snapshot'
import {
  claimDelivery,
  deliverClaimedNotification,
  deliverDueNotifications,
  deliverDueDigests,
  resolveGotify,
  enqueueNotifications,
  retryNotificationDelivery,
} from '../../src/lib/notifications/outbox'

vi.mock('../../src/lib/notifications/http', async (importOriginal) => {
  const original = await importOriginal<typeof NotificationTransport>()
  return {
    ...original,
    postNotification: async (
      url: string | URL,
      init: { headers: Record<string, string>; body: string },
      channel: 'gotify' | 'slack' | 'discord' | 'ntfy',
    ) => {
      if (channel === 'gotify' || channel === 'ntfy')
        return original.postNotification(url, init, channel)
      const response = await fetch(`${baseUrl}/${channel}`, {
        method: 'POST',
        ...init,
      })
      await response.body?.cancel()
      if (!response.ok)
        throw new original.NotificationHttpError(response.status)
    },
  }
})

const execFileAsync = promisify(execFile)
const initialTime = new Date('2026-01-01T10:00:00Z')
let clock = new Date(initialTime)
let area = 100
let gotifyStatus = 200
let baseUrl: string
let watchId: string
const requests: { path: string; body: string; token: string | undefined }[] = []

// Every network call goes to this local fixture, including a separate CLI process.
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const path = request.url ?? ''
  requests.push({
    path,
    body: Buffer.concat(chunks).toString(),
    token: request.headers['x-gotify-key'] as string | undefined,
  })
  response.setHeader('Content-Type', 'application/json')
  if (path === '/api/v1/Parcely/1') {
    response.end(
      JSON.stringify({ data: { id: 1, vymera: area, rizeniPlomby: [] } }),
    )
  } else if (path === '/message') {
    response.statusCode = gotifyStatus
    response.end(
      JSON.stringify({
        message: 'fixture response with a secret that must not be persisted',
      }),
    )
  } else if (path === '/slack' || path === '/discord' || path === '/topic') {
    response.end('{}')
  } else {
    response.statusCode = 404
    response.end('{}')
  }
})

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('no fixture port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.CUZK_API_BASE_URL = baseUrl
})

beforeEach(async () => {
  await db.delete(notificationPolicy)
  await db.delete(user)
  area = 100
  gotifyStatus = 200
  clock = new Date(initialTime)
  await db
    .insert(user)
    .values({ id: 'owner', name: 'Owner', email: 'owner@example.test' })
  await db.insert(userNotificationSettings).values({
    userId: 'owner',
    gotifyUrl: baseUrl,
    gotifyToken: encryptNotificationSecret(
      'old-test-token',
      'owner',
      'gotifyToken',
    ),
    slackWebhookUrl: encryptNotificationSecret(
      'https://hooks.slack.com/services/TTEST/BTEST/fixture',
      'owner',
      'slackWebhookUrl',
    ),
  })
  const snapshot = await buildParcelSnapshot('1', initialTime)
  const [watch] = await db
    .insert(parcelWatches)
    .values({
      userId: 'owner',
      label: 'Test parcel',
      kuCode: '777552',
      kuName: 'Test',
      parcelNumber: 1,
      isknId: '1',
      lastSnapshotJson: snapshot,
      lastCheckedAt: initialTime,
    })
    .returning()
  watchId = watch.id
  requests.length = 0
})

afterEach(async () => {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS reject_test_delivery ON notification_deliveries`,
  )
  await db.execute(sql`DROP FUNCTION IF EXISTS reject_test_delivery()`)
})

afterAll(async () => {
  await closeDb()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

async function detectChange() {
  area = 101
  return pollWatchById(watchId, clock)
}

async function deliveries() {
  return db.query.notificationDeliveries.findMany({
    orderBy: notificationDeliveries.channel,
  })
}

describe('durable notification outbox (PostgreSQL)', () => {
  it('pauses disabled channels without spending retry attempts and resumes after enabling', async () => {
    await detectChange()
    await db
      .insert(notificationPolicy)
      .values({ id: 1, gotifyEnabled: false, slackEnabled: false })
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(0)
    expect(
      (await deliveries()).every(
        (row) => row.attemptCount === 0 && row.status === 'pending',
      ),
    ).toBe(true)
    await db
      .update(notificationPolicy)
      .set({ gotifyEnabled: true, slackEnabled: true })
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(2)
  })

  it('sends native payloads to all three configured channels', async () => {
    await db.update(userNotificationSettings).set({
      discordWebhookUrl: encryptNotificationSecret(
        'https://discord.com/api/webhooks/123/fixture',
        'owner',
        'discordWebhookUrl',
      ),
    })
    expect((await detectChange()).queued).toBe(3)
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(3)
    const discord = requests.find((r) => r.path === '/discord')
    const slack = requests.find((r) => r.path === '/slack')
    expect(JSON.parse(discord!.body)).toMatchObject({
      content: expect.stringContaining('Změna atributů parcely'),
    })
    expect(JSON.parse(slack!.body)).toMatchObject({
      text: expect.stringContaining('Test parcel'),
    })
  })

  it('does not exceed the automatic budget when the last attempt crashes', async () => {
    await db.update(userNotificationSettings).set({ slackWebhookUrl: null })
    await detectChange()
    for (let i = 0; i < 8; i++) {
      expect(await claimDelivery(clock)).not.toBeNull()
      clock = new Date(clock.getTime() + 121_000)
    }
    expect((await deliverDueNotifications({ now: () => clock })).failed).toBe(1)
    expect((await deliveries())[0]).toMatchObject({
      status: 'failed',
      attemptCount: 8,
    })
    expect(requests.filter((r) => r.path === '/message')).toHaveLength(0)
  })

  it('commits snapshot, event and per-channel jobs without sending; a fresh CLI process drains them', async () => {
    await db.update(userNotificationSettings).set({ slackWebhookUrl: null })
    const result = await detectChange()
    expect(result.queued).toBe(1)
    expect(result.changes).toHaveLength(1)
    expect(requests.map((r) => r.path)).toEqual(['/api/v1/Parcely/1'])
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
    expect((await deliveries()).map((d) => d.status)).toEqual(['pending'])
    const watch = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, watchId),
    })
    expect(watch?.lastSnapshotJson).toMatchObject({ parcel: { vymera: 101 } })

    // No in-memory state or new parcel change is needed by the restarted worker.
    await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'scripts/cron.ts', '--once', 'deliver-notifications'],
      {
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        timeout: 20_000,
      },
    )
    expect((await deliveries()).map((d) => d.status)).toEqual(['sent'])
    expect(requests.filter((r) => r.path === '/message')).toHaveLength(1)
    expect(requests.filter((r) => r.path === '/slack')).toHaveLength(0)
    expect((await deliverDueNotifications()).sent).toBe(0)
  })

  it('rolls back the snapshot and event when queue insertion fails', async () => {
    await db.execute(
      sql`CREATE FUNCTION reject_test_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected delivery insert failure'; END $$`,
    )
    await db.execute(
      sql`CREATE TRIGGER reject_test_delivery BEFORE INSERT ON notification_deliveries FOR EACH ROW EXECUTE FUNCTION reject_test_delivery()`,
    )
    await expect(detectChange()).rejects.toThrow()
    expect(await deliveries()).toHaveLength(0)
    expect(await db.query.watchEvents.findMany()).toMatchObject([
      { kind: 'error' },
    ])
    const watch = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, watchId),
    })
    expect(watch?.lastSnapshotJson).toMatchObject({ parcel: { vymera: 100 } })
  })

  it('keeps Slack independent of Gotify failure and retries using repaired settings', async () => {
    gotifyStatus = 503
    await detectChange()
    expect(await deliverDueNotifications({ now: () => clock })).toMatchObject({
      sent: 1,
      pending: 1,
    })
    const [gotify, slack] = await deliveries()
    expect(gotify).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      lastError: 'Notifikační služba vrátila HTTP 503.',
    })
    expect(slack.status).toBe('sent')
    expect(await deliverDueNotifications({ now: () => clock })).toMatchObject({
      sent: 0,
      pending: 0,
    })
    const watch = await db.query.parcelWatches.findFirst({
      where: eq(parcelWatches.id, watchId),
    })
    expect(watch?.lastError).toBeNull()
    await db
      .update(userNotificationSettings)
      .set({
        gotifyToken: encryptNotificationSecret(
          'repaired-test-token',
          'owner',
          'gotifyToken',
        ),
      })
      .where(eq(userNotificationSettings.userId, 'owner'))
    gotifyStatus = 200
    clock = gotify.nextAttemptAt
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(1)
    expect(requests.filter((r) => r.path === '/slack')).toHaveLength(1)
    expect(requests.filter((r) => r.path === '/message').at(-1)?.token).toBe(
      'repaired-test-token',
    )
  })

  it('stores changes without claiming delivery when no channel is configured', async () => {
    await db.delete(userNotificationSettings)
    const result = await detectChange()
    expect(result.queued).toBe(0)
    expect(result.changes).toHaveLength(1)
    expect(await deliveries()).toHaveLength(0)
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
  })

  it('does not create deliveries for the first snapshot or an unchanged parcel', async () => {
    expect((await pollWatchById(watchId, clock)).queued).toBe(0)
    await db
      .update(parcelWatches)
      .set({ lastSnapshotJson: null })
      .where(eq(parcelWatches.id, watchId))
    expect((await pollWatchById(watchId, clock)).queued).toBe(0)
    expect(await deliveries()).toHaveLength(0)
    expect(await db.query.watchEvents.findMany()).toHaveLength(0)
  })

  it('enforces event/channel uniqueness when enqueueing again', async () => {
    const result = await detectChange()
    const [event] = await db.query.watchEvents.findMany()
    expect(
      await db.transaction((tx) =>
        enqueueNotifications(
          tx,
          event.id,
          {
            id: event.watchId,
            userId: 'owner',
            label: 'Test',
            notifyKinds: null,
            notifyChannels: null,
          },
          result.changes[0],
          clock,
        ),
      ),
    ).toBe(0)
    expect(await deliveries()).toHaveLength(2)
    const [delivery] = await deliveries()
    await expect(
      db.insert(notificationDeliveries).values({
        eventId: delivery.eventId,
        channel: delivery.channel,
        title: 'duplicate',
        message: 'duplicate',
      }),
    ).rejects.toThrow()
  })

  it('claims each delivery only once under concurrent workers', async () => {
    await detectChange()
    const claims = await Promise.all([
      claimDelivery(clock),
      claimDelivery(clock),
      claimDelivery(clock),
    ])
    const ids = claims.filter((c) => c !== null).map((c) => c.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('recovers an expired claim after a crash and refuses the previous claim', async () => {
    await db.update(userNotificationSettings).set({ slackWebhookUrl: null })
    await detectChange()
    const first = await claimDelivery(clock)
    expect(first).not.toBeNull()
    expect(await claimDelivery(clock)).toBeNull()
    clock = new Date(clock.getTime() + 121_000)
    const recovered = await claimDelivery(clock)
    expect(recovered?.id).toBe(first?.id)
    expect(recovered?.claimToken).not.toBe(first?.claimToken)
    expect(await deliverClaimedNotification(first!, () => clock)).toBe('stale')
    expect(await deliverClaimedNotification(recovered!, () => clock)).toBe(
      'sent',
    )
    expect(requests.filter((r) => r.path === '/message')).toHaveLength(1)
  })

  it('stops after eight failures; only the owner can requeue, and sent/processing rows cannot be retried', async () => {
    await db.update(userNotificationSettings).set({ slackWebhookUrl: null })
    await detectChange()
    gotifyStatus = 500
    for (let attempt = 1; attempt <= 8; attempt++) {
      await deliverDueNotifications({ now: () => clock })
      const [row] = await deliveries()
      expect(row.attemptCount).toBe(attempt)
      expect(row.status).toBe(attempt === 8 ? 'failed' : 'pending')
      clock = row.nextAttemptAt
    }
    const [failed] = await deliveries()
    expect((await deliverDueNotifications({ now: () => clock })).failed).toBe(0)
    await expect(
      retryNotificationDelivery(failed.id, 'another-user', clock),
    ).rejects.toThrow()
    await retryNotificationDelivery(failed.id, 'owner', clock)
    const claim = await claimDelivery(clock)
    await expect(
      retryNotificationDelivery(failed.id, 'owner', clock),
    ).rejects.toThrow()
    gotifyStatus = 200
    expect(await deliverClaimedNotification(claim!, () => clock)).toBe('sent')
    await expect(
      retryNotificationDelivery(failed.id, 'owner', clock),
    ).rejects.toThrow()
    expect((await deliveries())[0].attemptCount).toBe(1)
  })

  it('does not silently mark a removed channel as sent and cancels jobs when the watch is deleted', async () => {
    await detectChange()
    await db.delete(userNotificationSettings)
    await deliverDueNotifications({ now: () => clock })
    expect(
      (await deliveries()).every(
        (d) => d.status === 'pending' && d.lastError?.includes('Kanál už není'),
      ),
    ).toBe(true)
    expect(requests.filter((r) => r.path !== '/api/v1/Parcely/1')).toHaveLength(
      0,
    )
    await db.delete(parcelWatches).where(eq(parcelWatches.id, watchId))
    expect(await deliveries()).toHaveLength(0)
  })

  it('retries pending messages independently of parcel polling intervals and does not duplicate a detected change', async () => {
    await detectChange()
    expect(await pollDueWatches(clock)).toEqual({
      checked: 0,
      queued: 0,
      errors: 0,
      skipped: 0,
    })
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(2)
    expect((await pollWatchById(watchId, clock)).queued).toBe(0)
    expect(await deliveries()).toHaveLength(2)
    expect(
      await db
        .select()
        .from(watchEvents)
        .where(
          and(
            eq(watchEvents.watchId, watchId),
            eq(watchEvents.kind, 'parcel_attrs'),
          ),
        ),
    ).toHaveLength(1)
  })
})

describe('notification rules and durable digests', () => {
  async function digestChanges(count = 1) {
    await db
      .update(userNotificationSettings)
      .set({ slackWebhookUrl: null, digestMode: 'daily' })
    for (let i = 0; i < count; i++) {
      area++
      await pollWatchById(watchId, clock)
    }
    clock = (await deliveries())[0].nextAttemptAt
  }

  it('preserves filtered changes in history and respects selected channels', async () => {
    await db.update(parcelWatches).set({ notifyKinds: ['new_rizeni'] })
    expect((await detectChange()).queued).toBe(0)
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
    await db
      .update(parcelWatches)
      .set({ notifyKinds: null, notifyChannels: ['slack'] })
    area++
    expect((await pollWatchById(watchId, clock)).queued).toBe(1)
    expect((await deliveries()).map((row) => row.channel)).toEqual(['slack'])
  })

  it('acknowledges only events included in each bounded digest', async () => {
    await digestChanges(7)
    expect(await claimDelivery(clock)).toBeNull()
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(5)
    let rows = await deliveries()
    expect(rows.filter((row) => row.status === 'deferred')).toHaveLength(2)
    const first = JSON.parse(
      requests.filter((r) => r.path === '/message')[0].body,
    ).message as string
    for (const row of rows.filter((item) => item.status === 'sent'))
      expect(first).toContain(`event=${row.eventId}`)
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(2)
    rows = await deliveries()
    expect(rows.every((row) => row.status === 'sent')).toBe(true)
  })

  it('does not spend attempts during quiet hours; urgent events bypass them', async () => {
    await db
      .update(userNotificationSettings)
      .set({ slackWebhookUrl: null, quietFromMinutes: 0, quietToMinutes: 720 })
    await detectChange()
    expect(await claimDelivery(clock)).toBeNull()
    await db.update(notificationDeliveries).set({ nextAttemptAt: clock }) // a retry becoming due during quiet time
    const claim = await claimDelivery(clock)
    expect(await deliverClaimedNotification(claim!, () => clock)).toBe(
      'pending',
    )
    expect((await deliveries())[0].attemptCount).toBe(0)
    await db
      .update(userNotificationSettings)
      .set({ urgentKinds: ['parcel_attrs'], digestMode: 'daily' })
    area++
    await pollWatchById(watchId, clock)
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(1)
  })

  it('recovers expired digest claims without individual sends and separates attempt ceilings', async () => {
    await digestChanges(2)
    const [old, recent] = await deliveries()
    await db
      .update(notificationDeliveries)
      .set({
        status: 'processing',
        claimToken: crypto.randomUUID(),
        lockedUntil: new Date(clock.getTime() - 1),
        attemptCount: 7,
      })
      .where(eq(notificationDeliveries.id, old.id))
    gotifyStatus = 503
    expect(await claimDelivery(clock)).toBeNull()
    expect(await deliverDueDigests({ now: () => clock })).toMatchObject({
      failed: 1,
      pending: 1,
    })
    const rows = await deliveries()
    expect(rows.find((r) => r.id === old.id)).toMatchObject({
      status: 'failed',
      attemptCount: 8,
    })
    expect(rows.find((r) => r.id === recent.id)).toMatchObject({
      status: 'deferred',
      attemptCount: 1,
    })
    await expect(
      retryNotificationDelivery(old.id, 'other-user', clock),
    ).rejects.toThrow()
    await retryNotificationDelivery(old.id, 'owner', clock)
    expect(await claimDelivery(clock)).toBeNull()
    gotifyStatus = 200
    clock = rows.find((r) => r.id === recent.id)!.nextAttemptAt
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(2)
  })

  it('pauses digests when disabled or quiet and resumes without consuming events', async () => {
    await digestChanges()
    await db.insert(notificationPolicy).values({ id: 1, gotifyEnabled: false })
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(0)
    await db.update(notificationPolicy).set({ gotifyEnabled: true })
    await db
      .update(userNotificationSettings)
      .set({ quietFromMinutes: 0, quietToMinutes: 720 })
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(0)
    expect((await deliveries())[0]).toMatchObject({
      status: 'deferred',
      attemptCount: 0,
    })
    clock = new Date('2026-01-02T11:00:00Z')
    expect((await deliverDueDigests({ now: () => clock })).sent).toBe(1)
  })

  it('does not double-send rows under concurrent digest workers', async () => {
    await digestChanges(4)
    const results = await Promise.all([
      deliverDueDigests({ now: () => clock }),
      deliverDueDigests({ now: () => clock }),
    ])
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(4)
    expect(requests.filter((r) => r.path === '/message')).toHaveLength(1)
  })

  it('uses instance Gotify only with explicit opt-in and never mixes credentials', async () => {
    vi.stubEnv('GOTIFY_URL', baseUrl)
    vi.stubEnv('GOTIFY_TOKEN', 'instance-fixture')
    try {
      expect(resolveGotify(undefined)).toBeNull()
      const row = (await db.query.userNotificationSettings.findFirst())!
      expect(
        resolveGotify({ ...row, useInstanceGotify: true })?.encrypted,
      ).toBe(true)
      expect(
        resolveGotify({ ...row, gotifyToken: null, useInstanceGotify: true }),
      ).toBeNull()
      expect(
        resolveGotify({
          ...row,
          gotifyUrl: null,
          gotifyToken: null,
          useInstanceGotify: true,
        }),
      ).toMatchObject({ token: 'instance-fixture', encrypted: false })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sends ntfy through the pinned local transport and obeys administrator disabling', async () => {
    await db
      .update(userNotificationSettings)
      .set({
        gotifyUrl: null,
        gotifyToken: null,
        slackWebhookUrl: null,
        ntfyUrl: `${baseUrl}/topic`,
        ntfyToken: encryptNotificationSecret(
          'ntfy-fixture',
          'owner',
          'ntfyToken',
        ),
      })
    await db
      .insert(notificationPolicy)
      .values({ id: 1, ntfyAllowedUrls: [baseUrl], ntfyEnabled: false })
    await detectChange()
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(0)
    await db.update(notificationPolicy).set({ ntfyEnabled: true })
    expect((await deliverDueNotifications({ now: () => clock })).sent).toBe(1)
    expect(requests.find((r) => r.path === '/topic')?.body).toContain(
      'Změna atributů parcely',
    )
  })
})
