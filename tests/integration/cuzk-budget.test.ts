import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../../src/db'
import {
  cuzkApiControl,
  cuzkApiDailyUsage,
  cuzkApiRequests,
  parcelWatches,
  user,
} from '../../src/db/schema'
import { requestCuzk, refreshCuzkAccount } from '../../src/lib/cuzk/http'
import { apiIdentity, reserveApiRequest } from '../../src/lib/cuzk/budget'
import { getCuzkMetrics } from '../../src/lib/cuzk/metrics'
import { renderCuzkMetrics } from '../../src/lib/cuzk/prometheus'
import { insertWatchWithinLimit } from '../../src/lib/cuzk/watch-limits'
import { pollDueWatches, pollWatchById } from '../../src/cron/jobs/poll-parcels'

let calls = 0
let statuses: number[] = []
let retryAfter: string | null = null
let slow = false
let details = false
let invalid = false
let day: string
const account = {
  aktualniObdobi: 'fixture-period',
  provedenoVolani: 42,
  limitVolani: 500,
  expiraceApiKey: '2099-01-01T00:00:00Z',
}
const server = createServer((request, response) => {
  calls++
  const status = statuses.shift() ?? 200
  const reply = () => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    if (retryAfter) response.setHeader('Retry-After', retryAfter)
    if (invalid) {
      response.end('{}')
      return
    }
    response.end(
      JSON.stringify(
        request.url?.endsWith('/StavUctu')
          ? account
          : {
              data: {
                id: 1,
                vymera: 100,
                rizeniPlomby: details ? [{ id: 44, typRizeni: 'V' }] : [],
              },
            },
      ),
    )
  }
  if (slow) setTimeout(reply, 100)
  else reply()
})

async function reset() {
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await db.delete(cuzkApiControl)
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('fixture port missing')
  process.env.CUZK_API_BASE_URL = `http://127.0.0.1:${address.port}`
  const [row] = await db.execute<{ day: string }>(
    sql`select to_char(clock_timestamp() at time zone 'Europe/Prague', 'YYYY-MM-DD') as day`,
  )
  day = row.day
})
beforeEach(async () => {
  await reset()
  await db.delete(user)
  calls = 0
  statuses = []
  retryAfter = null
  slow = false
  details = false
  invalid = false
  process.env.CUZK_API_KEY = 'integration-test-only'
  process.env.CUZK_REQUEST_TIMEOUT_MS = '15000'
  process.env.CUZK_MIN_REQUEST_INTERVAL_MS = '0'
  process.env.MAX_WATCHES_PER_USER = '100'
})
afterAll(async () => {
  await reset()
  await db.delete(user)
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

const parcel = '/api/v1/Parcely/123'
const watchValues = {
  userId: 'quota-owner',
  label: 'Test',
  kuCode: '777552',
  kuName: 'Test',
  parcelNumber: 1,
  isknId: '1',
  pollIntervalMinutes: 60,
}
async function owner() {
  await db
    .insert(user)
    .values({ id: 'quota-owner', name: 'Owner', email: 'quota@example.test' })
}

describe('durable shared CUZK budget and telemetry', () => {
  it('returns an empty read-only dashboard before the first API call', async () => {
    const m = await getCuzkMetrics()
    expect(m.today).toMatchObject({ reserved: 0, success: 0, pending: 0 })
    expect(m.remaining).toBe(500)
    expect(m.account).toBeNull()
    expect(m.endpoints).toEqual([])
    expect(calls).toBe(0)
    expect(await db.select().from(cuzkApiControl)).toHaveLength(0)
  })
  it('shares the budget with an independent CLI process and retains it after process exit', async () => {
    await db.insert(cuzkApiDailyUsage).values({ day, reserved: 499 })
    const run = () =>
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '--eval',
          `import { requestCuzk } from './src/lib/cuzk/http.ts';
       import { closeDb } from './src/db/index.ts';
       try { await requestCuzk('/api/v1/Parcely/123'); }
       catch { process.exitCode = 2; } finally { await closeDb(); }`,
        ],
        {
          env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
        },
      )
    await run()
    await expect(run()).rejects.toMatchObject({ code: 2 })
    expect(calls).toBe(1)
    expect((await getCuzkMetrics()).today.reserved).toBe(500)
  })
  it('stops repeated server errors after three attempts and permits subsequent callers', async () => {
    statuses = [503, 503, 503, 200]
    await expect(requestCuzk(parcel)).rejects.toThrow('503')
    expect(calls).toBe(3)
    await requestCuzk(parcel)
    expect(calls).toBe(4)
  })

  it('allows exactly one concurrent request at 499 and survives key rotation', async () => {
    await db.insert(cuzkApiDailyUsage).values({ day, reserved: 499 })
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => requestCuzk(parcel)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(calls).toBe(1)
    expect((await getCuzkMetrics()).remaining).toBe(0)
    process.env.CUZK_API_KEY = 'rotated-fixture-key'
    await expect(requestCuzk(parcel)).rejects.toThrow('500')
    expect(calls).toBe(1)
  })
  it('stores a slow-hash key fingerprint that changes with key and endpoint', async () => {
    await requestCuzk(parcel)
    const [control] = await db.select().from(cuzkApiControl)
    const { key, base, fingerprint } = apiIdentity()
    expect(control.keyFingerprint).toBe(fingerprint)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).not.toBe(
      createHash('sha256').update(`${base}\0${key}`).digest('hex'),
    )
    expect(JSON.stringify(control)).not.toContain(key)
    process.env.CUZK_API_KEY = 'rotated-fixture-key'
    expect(apiIdentity().fingerprint).not.toBe(fingerprint)
    process.env.CUZK_API_KEY = key
    expect(apiIdentity().fingerprint).toBe(fingerprint)
  })
  it('counts every retry, records durations, and normalizes identifiers out of metrics', async () => {
    statuses = [503, 500, 200]
    await requestCuzk(parcel, { secret: 'must-not-be-stored' })
    const m = await getCuzkMetrics()
    expect(m.today).toMatchObject({
      reserved: 3,
      success: 1,
      errors: 2,
      retries: 2,
      pending: 0,
    })
    expect(m.endpoints).toMatchObject([
      { endpoint: '/api/v1/Parcely/:id', requests: 3, errors: 2 },
    ])
    expect(m.today.averageMs).toBeGreaterThanOrEqual(0)
    expect(m.history).toHaveLength(30)
    expect(m.history[1].reserved).toBe(0)
    expect(JSON.stringify(m)).not.toContain('must-not-be-stored')
    expect(renderCuzkMetrics(m)).toContain('hlidac_cuzk_daily_reserved 3\n')
    expect(calls).toBe(3) // Reading/exporting metrics spends nothing.
  })
  it('never retries past the remaining daily budget', async () => {
    await db.insert(cuzkApiDailyUsage).values({ day, reserved: 499 })
    statuses = [500, 200]
    await expect(requestCuzk(parcel)).rejects.toThrow('500 volání')
    expect(calls).toBe(1)
  })
  it('does not retry 404 and shares an auth failure pause across callers', async () => {
    statuses = [404, 401]
    await expect(requestCuzk(parcel)).rejects.toThrow('404')
    await expect(requestCuzk(parcel)).rejects.toThrow('401')
    await expect(requestCuzk(parcel)).rejects.toThrow('klíč')
    expect(calls).toBe(2)
    expect((await getCuzkMetrics()).today.errors).toBe(2)
  })
  it('persists long Retry-After instead of holding a worker open', async () => {
    statuses = [429]
    retryAfter = '120'
    await expect(requestCuzk(parcel)).rejects.toThrow('omezilo')
    await expect(requestCuzk(parcel)).rejects.toThrow('přestávku')
    expect(calls).toBe(1)
    expect(
      Date.parse((await getCuzkMetrics()).blockedUntil!) - Date.now(),
    ).toBeGreaterThan(110000)
  })
  it('respects a short Retry-After and retries successfully', async () => {
    statuses = [429, 200]
    retryAfter = '1'
    const start = Date.now()
    await requestCuzk(parcel)
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000)
    expect(calls).toBe(2)
  })
  it('bounds timeouts to three attempts and counts all three', async () => {
    slow = true
    process.env.CUZK_REQUEST_TIMEOUT_MS = '20'
    await expect(requestCuzk(parcel)).rejects.toThrow('časovém limitu')
    expect(calls).toBe(3)
    expect((await getCuzkMetrics()).today).toMatchObject({
      reserved: 3,
      errors: 3,
      retries: 2,
    })
    expect(
      (await db.select().from(cuzkApiRequests)).every(
        (r) => r.outcome === 'timeout',
      ),
    ).toBe(true)
  })
  it('preserves an unfinished reservation and uses a separate counter for today', async () => {
    await db
      .insert(cuzkApiDailyUsage)
      .values({ day: '2000-01-01', reserved: 500 })
    await reserveApiRequest('/api/v1/Parcely/:id', 1)
    await requestCuzk(parcel)
    expect((await getCuzkMetrics()).today).toMatchObject({
      reserved: 2,
      pending: 1,
      success: 1,
    })
    expect(calls).toBe(1)
  })
  it('records a malformed account response as an error without retrying or caching it', async () => {
    invalid = true
    await expect(refreshCuzkAccount()).rejects.toThrow('neplatnou odpověď')
    expect(calls).toBe(1)
    const m = await getCuzkMetrics()
    expect(m.account).toBeNull()
    expect(m.today).toMatchObject({ reserved: 1, errors: 1, success: 0 })
  })
  it('caches account diagnostics globally and enforces the reported remaining quota', async () => {
    const results = await Promise.all([
      refreshCuzkAccount(),
      refreshCuzkAccount(),
    ])
    expect(results.filter((r) => r.refreshed)).toHaveLength(1)
    expect(calls).toBe(1)
    expect((await getCuzkMetrics()).account).toEqual(account)
    await db
      .update(cuzkApiControl)
      .set({ accountJson: { ...account, provedenoVolani: 499 } })
    await requestCuzk(parcel)
    await expect(requestCuzk(parcel)).rejects.toThrow('kvóta')
    expect(calls).toBe(2)
  })
  it('serializes request start spacing across concurrent callers', async () => {
    process.env.CUZK_MIN_REQUEST_INTERVAL_MS = '50'
    await Promise.all([
      requestCuzk(parcel),
      requestCuzk(parcel),
      requestCuzk(parcel),
    ])
    const rows = await db
      .select()
      .from(cuzkApiRequests)
      .orderBy(cuzkApiRequests.startedAt)
    expect(
      rows[2].startedAt.getTime() - rows[0].startedAt.getTime(),
    ).toBeGreaterThanOrEqual(100)
  })
  it('enforces manual cooldown atomically without spending another request', async () => {
    await owner()
    const row = await insertWatchWithinLimit(watchValues)
    const results = await Promise.all([
      pollWatchById(row.id, new Date(), { manual: true }),
      pollWatchById(row.id, new Date(), { manual: true }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['checked', 'cooldown'])
    expect(
      (await pollWatchById(row.id, new Date(), { manual: true })).status,
    ).toBe('cooldown')
    expect(calls).toBe(1)
    await db
      .update(parcelWatches)
      .set({ manualRefreshAfter: new Date(0) })
      .where(eq(parcelWatches.id, row.id))
    expect(
      (await pollWatchById(row.id, new Date(), { manual: true })).status,
    ).toBe('checked')
  })
  it('enforces the watch cap for concurrent inserts', async () => {
    await owner()
    process.env.MAX_WATCHES_PER_USER = '1'
    const results = await Promise.allSettled([
      insertWatchWithinLimit(watchValues),
      insertWatchWithinLimit(watchValues),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.select().from(parcelWatches)).toHaveLength(1)
    expect(calls).toBe(0)
  })
  it('loads a shared proceeding once per cron cycle', async () => {
    await owner()
    await insertWatchWithinLimit(watchValues)
    await insertWatchWithinLimit({
      ...watchValues,
      isknId: '2',
      parcelNumber: 2,
    })
    details = true
    expect(await pollDueWatches()).toMatchObject({ checked: 2, errors: 0 })
    expect(calls).toBe(3) // Two parcels and one shared proceeding.
  })
  it('does not replace a snapshot when the budget runs out during details', async () => {
    await owner()
    const row = await insertWatchWithinLimit({
      ...watchValues,
      lastSnapshotJson: { sentinel: true },
    })
    await db.insert(cuzkApiDailyUsage).values({ day, reserved: 499 })
    details = true
    await expect(pollWatchById(row.id)).rejects.toThrow('500 volání')
    const [saved] = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.id, row.id))
    expect(saved.lastSnapshotJson).toEqual({ sentinel: true })
    expect(calls).toBe(1)
  })
})
