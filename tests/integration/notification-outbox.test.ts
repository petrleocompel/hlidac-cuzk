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
} from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  notificationDeliveries,
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
  enqueueNotifications,
  retryNotificationDelivery,
} from '../../src/lib/notifications/outbox'

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
  } else if (path === '/slack' || path === '/discord') {
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
    gotifyToken: 'old-test-token',
    slackWebhookUrl: `${baseUrl}/slack`,
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
  it('sends native payloads to all three configured channels', async () => {
    await db
      .update(userNotificationSettings)
      .set({ discordWebhookUrl: `${baseUrl}/discord` })
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
    const result = await detectChange()
    expect(result.queued).toBe(2)
    expect(result.changes).toHaveLength(1)
    expect(requests.map((r) => r.path)).toEqual(['/api/v1/Parcely/1'])
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
    expect((await deliveries()).map((d) => d.status)).toEqual([
      'pending',
      'pending',
    ])
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
    expect((await deliveries()).map((d) => d.status)).toEqual(['sent', 'sent'])
    expect(requests.filter((r) => r.path === '/message')).toHaveLength(1)
    expect(requests.filter((r) => r.path === '/slack')).toHaveLength(1)
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
      .set({ gotifyToken: 'repaired-test-token' })
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
          'owner',
          'Test',
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
