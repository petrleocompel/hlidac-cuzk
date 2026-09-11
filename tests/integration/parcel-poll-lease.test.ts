import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { eq } from 'drizzle-orm'
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
  parcelWatches,
  user,
  userNotificationSettings,
} from '../../src/db/schema'
import { pollDueWatches, pollWatchById } from '../../src/cron/jobs/poll-parcels'
import { buildParcelSnapshot } from '../../src/lib/cuzk/snapshot'

const checkedAt = new Date('2026-01-01T10:00:00Z')
const dueAt = new Date('2026-01-01T12:00:00Z')
let watchId: string
let baseUrl: string
let area = 100
let blockPath: string | null = null
let withRizeni = false
let requestCount = 0
let notifyRequest: (() => void) | null = null
const pending: { response: ServerResponse; area: number }[] = []
const workers: ReturnType<typeof worker>[] = []

const server = createServer((request, response) => {
  requestCount += 1
  response.setHeader('Content-Type', 'application/json')
  if (request.url === blockPath) {
    pending.push({ response, area })
    notifyRequest?.()
    return
  }
  response.end(
    JSON.stringify({
      data: {
        id: 1,
        vymera: area,
        rizeniPlomby: withRizeni ? [{ id: 44, typRizeni: 'V' }] : [],
      },
    }),
  )
})

function hold(path = '/api/v1/Parcely/1') {
  blockPath = path
  return new Promise<void>((resolve) => {
    notifyRequest = resolve
  })
}

function release(status = 200) {
  blockPath = null
  notifyRequest = null
  for (const item of pending.splice(0)) {
    item.response.statusCode = status
    item.response.end(
      JSON.stringify({ data: { id: 1, vymera: item.area, rizeniPlomby: [] } }),
    )
  }
}

function worker() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/cron.ts', '--once', 'poll-parcels'],
    {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  child.stdout.on('data', (data: Buffer) => {
    stdout += data.toString()
  })
  const done = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
  }>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({ code, signal, stdout }))
  })
  return { child, done }
}

function startWorker() {
  const run = worker()
  workers.push(run)
  return run
}

async function expireLease() {
  await db
    .update(parcelWatches)
    .set({ pollLockedUntil: new Date(0) })
    .where(eq(parcelWatches.id, watchId))
}

async function watch() {
  return db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, watchId),
  })
}

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
  withRizeni = false
  await db
    .insert(user)
    .values({ id: 'lease-owner', name: 'Owner', email: 'lease@example.test' })
  await db
    .insert(userNotificationSettings)
    .values({ userId: 'lease-owner', slackWebhookUrl: `${baseUrl}/slack` })
  const snapshot = await buildParcelSnapshot('1', checkedAt)
  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId: 'lease-owner',
      label: 'Lease test',
      pollIntervalMinutes: 60,
      kuCode: '777552',
      kuName: 'Test',
      parcelNumber: 1,
      isknId: '1',
      lastSnapshotJson: snapshot,
      lastCheckedAt: checkedAt,
    })
    .returning()
  watchId = row.id
  area = 101
  requestCount = 0
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const run of workers.splice(0)) {
    if (run.child.exitCode === null && run.child.signalCode === null)
      run.child.kill('SIGKILL')
    await run.done
  }
  release()
})

afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('parcel poll lease (PostgreSQL and independent processes)', () => {
  it('two cron processes and a manual refresh produce one request and one event/outbox set', async () => {
    const arrived = hold()
    const first = startWorker()
    await Promise.race([
      arrived,
      first.done.then((result) => {
        throw new Error(`Worker exited before request: ${result.stdout}`)
      }),
    ])
    const second = startWorker()
    const [secondResult, manual] = await Promise.all([
      second.done,
      pollWatchById(watchId, dueAt),
    ])
    expect(secondResult.code).toBe(0)
    expect(secondResult.stdout).toContain('skipped: 1')
    expect(manual.status).toBe('busy')
    expect(requestCount).toBe(1)
    release()
    expect((await first.done).code).toBe(0)
    const events = await db.query.watchEvents.findMany({
      with: { deliveries: true },
    })
    expect(events).toHaveLength(1)
    expect(events[0].deliveries).toHaveLength(1)
    expect((await watch())?.pollClaimToken).toBeNull()
    expect((await pollWatchById(watchId, dueAt)).changes).toHaveLength(0)
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
  })

  it('recovers a hard-killed worker after lease expiry', async () => {
    const arrived = hold()
    const first = startWorker()
    await Promise.race([
      arrived,
      first.done.then((result) => {
        throw new Error(`Worker exited before request: ${result.stdout}`)
      }),
    ])
    first.child.kill('SIGKILL')
    expect((await first.done).signal).toBe('SIGKILL')
    expect((await watch())?.pollClaimToken).not.toBeNull()
    expect((await pollWatchById(watchId, dueAt)).status).toBe('busy')
    await expireLease()
    release()
    expect((await pollWatchById(watchId, dueAt)).status).toBe('checked')
    expect(await db.query.watchEvents.findMany()).toHaveLength(1)
    expect((await watch())?.pollClaimToken).toBeNull()
  })

  it.each([200, 500])(
    'discards an old HTTP %i result after a replacement worker succeeds',
    async (status) => {
      const arrived = hold()
      const original = pollWatchById(watchId, dueAt)
      await arrived
      await expireLease()
      blockPath = null
      area = 102
      const newerTime = new Date(dueAt.getTime() + 1_000)
      expect((await pollWatchById(watchId, newerTime)).status).toBe('checked')
      release(status)
      expect((await original).status).toBe('superseded')
      expect(await watch()).toMatchObject({
        lastSnapshotJson: { parcel: { vymera: 102 } },
        lastError: null,
        lastCheckedAt: newerTime,
      })
      const events = await db.query.watchEvents.findMany({
        with: { deliveries: true },
      })
      expect(events).toHaveLength(1)
      expect(events[0].deliveries).toHaveLength(1)
    },
  )

  it('an expired result cannot commit even before another worker takes over', async () => {
    const arrived = hold()
    const original = pollWatchById(watchId, dueAt)
    await arrived
    await expireLease()
    release()
    expect((await original).status).toBe('superseded')
    expect(await watch()).toMatchObject({
      lastSnapshotJson: { parcel: { vymera: 100 } },
      pollClaimToken: null,
    })
    expect(await db.query.watchEvents.findMany()).toHaveLength(0)
    expect((await pollWatchById(watchId, dueAt)).status).toBe('checked')
  })

  it('cron rechecks due time and enabled state at claim time', async () => {
    await pollWatchById(watchId, dueAt)
    requestCount = 0
    expect(
      (await pollWatchById(watchId, dueAt, { onlyIfDue: true })).status,
    ).toBe('not_due')
    expect(await pollDueWatches(dueAt)).toEqual({
      checked: 0,
      queued: 0,
      errors: 0,
      skipped: 0,
    })
    await db
      .update(parcelWatches)
      .set({ enabled: false, lastCheckedAt: checkedAt })
      .where(eq(parcelWatches.id, watchId))
    expect(
      (await pollWatchById(watchId, dueAt, { onlyIfDue: true })).status,
    ).toBe('not_due')
    expect(requestCount).toBe(0)
    // Pausing scheduled checks still allows an explicit manual refresh.
    expect((await pollWatchById(watchId, dueAt)).status).toBe('checked')
  })

  it('releases the lease on failure and does not commit an aborted detail as a partial snapshot', async () => {
    const controller = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)
    withRizeni = true
    const arrived = hold('/api/v1/Rizeni/44')
    const original = pollWatchById(watchId, dueAt)
    const failed = expect(original).rejects.toThrow('90 sekund')
    await arrived
    controller.abort(new DOMException('test timeout', 'TimeoutError'))
    await failed
    expect(timeout).toHaveBeenCalledWith(90_000)
    expect(await watch()).toMatchObject({
      lastSnapshotJson: { parcel: { vymera: 100 } },
      pollClaimToken: null,
      pollLockedUntil: null,
    })
    expect(await db.query.watchEvents.findMany()).toMatchObject([
      { kind: 'error' },
    ])
    expect(await db.query.notificationDeliveries.findMany()).toHaveLength(0)
    timeout.mockRestore()
    release()
    withRizeni = false
    expect((await pollWatchById(watchId, dueAt)).status).toBe('checked')
    expect((await watch())?.lastError).toBeNull()
  })

  it('ignores a result for a watch deleted during the request', async () => {
    const arrived = hold()
    const original = pollWatchById(watchId, dueAt)
    await arrived
    await db.delete(parcelWatches).where(eq(parcelWatches.id, watchId))
    release()
    expect((await original).status).toBe('superseded')
    expect(await db.query.watchEvents.findMany()).toHaveLength(0)
  })
})
