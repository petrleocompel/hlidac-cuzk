import { createServer } from 'node:http'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  cuzkApiControl,
  cuzkApiDailyUsage,
  cuzkApiRequests,
  parcelWatches,
  user,
  workerHealth,
  workerJobs,
} from '../../src/db/schema'
import {
  recordHeartbeat,
  trackWorkerJob,
} from '../../src/lib/monitoring/worker'
import {
  getMonitoringStatus,
  renderMonitoringMetrics,
} from '../../src/lib/monitoring/status'
import { probeReadiness } from '../../src/lib/monitoring/readiness'
import { pollWatchById } from '../../src/cron/jobs/poll-parcels'

let status = 200
const server = createServer((_request, response) => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(
    JSON.stringify({ data: { id: 1, vymera: 100, rizeniPlomby: [] } }),
  )
})
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture port')
  process.env.CUZK_API_BASE_URL = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.delete(user)
  await db.delete(workerHealth)
  await db.delete(workerJobs)
  await db.delete(cuzkApiRequests)
  await db.delete(cuzkApiDailyUsage)
  await db.delete(cuzkApiControl)
  status = 200
})
afterAll(async () => {
  await closeDb()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
async function jobs() {
  await trackWorkerJob('poll-parcels', async () => ({ checked: 0, errors: 0 }))
  await trackWorkerJob('deliver-notifications', async () => ({
    sent: 0,
    failed: 0,
  }))
  await trackWorkerJob('deliver-digests', async () => ({ sent: 0, failed: 0 }))
}
async function watch() {
  await db
    .insert(user)
    .values({ id: 'health-owner', name: 'Owner', email: 'health@example.test' })
  const [row] = await db
    .insert(parcelWatches)
    .values({
      userId: 'health-owner',
      label: 'Test',
      kuCode: '777552',
      kuName: 'Test',
      parcelNumber: 1,
      isknId: '1',
      pollIntervalMinutes: 60,
    })
    .returning()
  return row
}

describe('worker health, readiness and successful data age', () => {
  it('never treats a missing scheduler or missing job progress as healthy', async () => {
    expect(await getMonitoringStatus()).toMatchObject({
      healthy: false,
      heartbeatHealthy: false,
      progressHealthy: false,
    })
    await recordHeartbeat(true)
    expect(await getMonitoringStatus()).toMatchObject({
      healthy: false,
      heartbeatHealthy: true,
      progressHealthy: false,
    })
    await jobs()
    expect(await getMonitoringStatus()).toMatchObject({ healthy: true })
  })
  it('detects a stopped scheduler and persists recovery without resetting it on each heartbeat', async () => {
    await jobs()
    await recordHeartbeat(true)
    await db
      .update(workerHealth)
      .set({ heartbeatAt: new Date(Date.now() - 180_000) })
    expect((await getMonitoringStatus()).healthy).toBe(false)
    await recordHeartbeat()
    const recovered = await getMonitoringStatus()
    expect(recovered.healthy).toBe(true)
    expect(recovered.lastOutageAt).not.toBeNull()
    expect(recovered.recoveredAt).not.toBeNull()
    await recordHeartbeat()
    expect((await getMonitoringStatus()).recoveredAt).toBe(
      recovered.recoveredAt,
    )
    expect(renderMonitoringMetrics(recovered)).toContain(
      'hlidac_monitoring_healthy 1\n',
    )
  })
  it('detects stuck jobs even when scheduler heartbeats continue', async () => {
    await recordHeartbeat()
    await jobs()
    await db
      .update(workerJobs)
      .set({ finishedAt: new Date(Date.now() - 660_000) })
      .where(eq(workerJobs.name, 'poll-parcels'))
    expect(await getMonitoringStatus()).toMatchObject({
      healthy: false,
      heartbeatHealthy: true,
      progressHealthy: false,
    })
  })
  it('records failed job summaries without advancing the last success', async () => {
    await jobs()
    const [before] = await db
      .select()
      .from(workerJobs)
      .where(eq(workerJobs.name, 'poll-parcels'))
    await trackWorkerJob('poll-parcels', async () => ({
      checked: 1,
      errors: 1,
    }))
    const [after] = await db
      .select()
      .from(workerJobs)
      .where(eq(workerJobs.name, 'poll-parcels'))
    expect(after.lastSuccessfulAt).toEqual(before.lastSuccessfulAt)
    expect(after.summary).toEqual({ checked: 1, errors: 1 })
    expect(after.lastError).not.toBeNull()
  })
  it('fences a delayed older job summary after a newer run finishes', async () => {
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = trackWorkerJob('poll-parcels', async () => {
      started()
      await held
      return { checked: 1 }
    })
    await ready
    await trackWorkerJob('poll-parcels', async () => ({ checked: 2 }))
    release()
    await first
    const [job] = await db
      .select()
      .from(workerJobs)
      .where(eq(workerJobs.name, 'poll-parcels'))
    expect(job.summary).toEqual({ checked: 2 })
  })
  it('preserves successful data timestamps on failure and schedules a bounded retry', async () => {
    const row = await watch()
    const first = new Date('2026-01-01T10:00:00Z')
    const second = new Date('2026-01-01T11:00:00Z')
    await pollWatchById(row.id, first)
    status = 500
    await expect(pollWatchById(row.id, second)).rejects.toThrow('500')
    const [saved] = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.id, row.id))
    expect(saved.lastAttemptAt).toEqual(second)
    expect(saved.lastSuccessfulCheckAt).toEqual(first)
    expect(saved.nextCheckAt).toEqual(new Date('2026-01-01T11:05:00Z'))
    expect(saved.lastSnapshotJson).toMatchObject({
      fetchedAt: first.toISOString(),
    })
    status = 200
    await pollWatchById(row.id, new Date('2026-01-01T11:05:00Z'))
    const [recovered] = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.id, row.id))
    expect(recovered.lastSuccessfulCheckAt).toEqual(
      new Date('2026-01-01T11:05:00Z'),
    )
    expect(recovered.nextCheckAt).toEqual(new Date('2026-01-01T12:05:00Z'))
    expect(recovered.lastError).toBeNull()
  })
  it('flags overdue/stale watches and excludes paused watches', async () => {
    const row = await watch()
    await jobs()
    await recordHeartbeat()
    await db
      .update(parcelWatches)
      .set({
        createdAt: new Date(Date.now() - 7200_000),
        nextCheckAt: new Date(Date.now() - 660_000),
      })
      .where(eq(parcelWatches.id, row.id))
    expect(await getMonitoringStatus()).toMatchObject({
      healthy: false,
      watches: { overdue: 1, stale: 1, neverSuccessful: 1 },
    })
    await db
      .update(parcelWatches)
      .set({ enabled: false })
      .where(eq(parcelWatches.id, row.id))
    expect(await getMonitoringStatus()).toMatchObject({
      healthy: true,
      watches: { overdue: 0, stale: 0, active: 0 },
    })
  })
  it('backfills successful time from the saved snapshot instead of a later failed attempt', async () => {
    const row = await watch()
    await db
      .update(parcelWatches)
      .set({
        lastCheckedAt: new Date('2026-01-02T12:00:00Z'),
        lastError: 'later failure',
        lastSnapshotJson: { version: 1, fetchedAt: '2026-01-01T12:00:00Z' },
      })
      .where(eq(parcelWatches.id, row.id))
    const migration = readMigrationFiles({
      migrationsFolder: './drizzle',
    }).find((entry) =>
      entry.sql.some((query) => query.includes('pg_temp.hlidac_snapshot_time')),
    )!
    await db.transaction(async (tx) => {
      for (const query of migration.sql.slice(-2))
        await tx.execute(sql.raw(query))
    })
    const [saved] = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.id, row.id))
    expect(saved.lastAttemptAt).toEqual(new Date('2026-01-02T12:00:00Z'))
    expect(saved.lastSuccessfulCheckAt).toEqual(
      new Date('2026-01-01T12:00:00Z'),
    )
    await db
      .update(parcelWatches)
      .set({ lastSnapshotJson: { fetchedAt: 'invalid timestamp' } })
      .where(eq(parcelWatches.id, row.id))
    await db.transaction(async (tx) => {
      for (const query of migration.sql.slice(-2))
        await tx.execute(sql.raw(query))
    })
    const [unknown] = await db
      .select()
      .from(parcelWatches)
      .where(eq(parcelWatches.id, row.id))
    expect(unknown.lastSuccessfulCheckAt).toBeNull()
  })
  it('readiness depends on the database/schema, not the scheduler or CUZK', async () => {
    expect(await probeReadiness()).toBe(true)
    expect((await getMonitoringStatus()).healthy).toBe(false)
    expect(
      await probeReadiness(
        'postgres://postgres:fixture@127.0.0.1:1/hlidac_test_missing',
      ),
    ).toBe(false)
  })
  it('readiness rejects a missing migration without applying it', async () => {
    const migration = readMigrationFiles({ migrationsFolder: './drizzle' }).at(
      -1,
    )!
    await db.execute(
      sql`update drizzle.__drizzle_migrations set hash = 'fixture-invalid' where created_at = ${migration.folderMillis}`,
    )
    try {
      expect(await probeReadiness()).toBe(false)
    } finally {
      await db.execute(
        sql`update drizzle.__drizzle_migrations set hash = ${migration.hash} where created_at = ${migration.folderMillis}`,
      )
    }
    expect(await probeReadiness()).toBe(true)
  })
})
