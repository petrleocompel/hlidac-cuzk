import { eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, workerHealth, workerJobs } from '#/db/schema'
import { HEARTBEAT_GRACE_SECONDS } from './worker'

export async function getMonitoringStatus() {
  const [clock] = await db.execute<{ now: string }>(
    sql`select clock_timestamp()::text as now`,
  )
  const now = new Date(clock.now)
  const heartbeat = (
    await db.select().from(workerHealth).where(eq(workerHealth.id, 'scheduler'))
  ).at(0)
  const jobs = await db.select().from(workerJobs).orderBy(workerJobs.name)
  const [watches] = await db
    .select({
      active: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where coalesce(${parcelWatches.nextCheckAt}, ${parcelWatches.createdAt}) < ${now.toISOString()}::timestamptz - interval '10 minutes')::int`,
      stale: sql<number>`count(*) filter (where coalesce(${parcelWatches.lastSuccessfulCheckAt}, ${parcelWatches.createdAt}) + ${parcelWatches.pollIntervalMinutes} * interval '1 minute' < ${now.toISOString()}::timestamptz - interval '10 minutes')::int`,
      neverSuccessful: sql<number>`count(*) filter (where ${parcelWatches.lastSuccessfulCheckAt} is null)::int`,
    })
    .from(parcelWatches)
    .where(eq(parcelWatches.enabled, true))
  const heartbeatHealthy =
    !!heartbeat &&
    now.getTime() - heartbeat.heartbeatAt.getTime() <=
      HEARTBEAT_GRACE_SECONDS * 1000
  const poll = jobs.find((j) => j.name === 'poll-parcels')
  const deliveries = jobs.find((j) => j.name === 'deliver-notifications')
  const digests = jobs.find((j) => j.name === 'deliver-digests')
  const progressHealthy = [poll, deliveries, digests].every(
    (job) =>
      !!job?.finishedAt && now.getTime() - job.finishedAt.getTime() <= 600_000,
  )
  const healthy =
    heartbeatHealthy &&
    progressHealthy &&
    !poll?.lastError &&
    !deliveries?.lastError &&
    !digests?.lastError &&
    watches.overdue === 0 &&
    watches.stale === 0
  return {
    healthy,
    heartbeatHealthy,
    progressHealthy,
    checkedAt: now.toISOString(),
    watches,
    heartbeatAt: heartbeat?.heartbeatAt.toISOString() ?? null,
    startedAt: heartbeat?.startedAt.toISOString() ?? null,
    lastOutageAt: heartbeat?.lastOutageAt?.toISOString() ?? null,
    recoveredAt: heartbeat?.recoveredAt?.toISOString() ?? null,
    jobs: jobs.map((j) => ({
      name: j.name,
      startedAt: j.startedAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
      lastSuccessfulAt: j.lastSuccessfulAt?.toISOString() ?? null,
      lastError: j.lastError,
      summary: j.summary,
    })),
  }
}
export type MonitoringStatus = Awaited<ReturnType<typeof getMonitoringStatus>>

export function renderMonitoringMetrics(m: MonitoringStatus) {
  const gauge = (name: string, help: string, value: number) =>
    `# HELP hlidac_${name} ${help}\n# TYPE hlidac_${name} gauge\nhlidac_${name} ${value}\n`
  return [
    gauge(
      'monitoring_healthy',
      'Scheduler heartbeat, job progress and parcel freshness are healthy.',
      Number(m.healthy),
    ),
    gauge(
      'worker_heartbeat_healthy',
      'Scheduler heartbeat is at most 120 seconds old.',
      Number(m.heartbeatHealthy),
    ),
    gauge(
      'worker_progress_healthy',
      'Poll, delivery and digest jobs completed within ten minutes.',
      Number(m.progressHealthy),
    ),
    gauge(
      'worker_heartbeat_timestamp_seconds',
      'Last scheduler heartbeat, zero if unknown.',
      m.heartbeatAt ? Date.parse(m.heartbeatAt) / 1000 : 0,
    ),
    gauge(
      'worker_recovered_timestamp_seconds',
      'Last observed recovery after a heartbeat gap, zero if none.',
      m.recoveredAt ? Date.parse(m.recoveredAt) / 1000 : 0,
    ),
    gauge(
      'watches_overdue',
      'Active watches overdue by more than ten minutes.',
      m.watches.overdue,
    ),
    gauge(
      'watches_stale',
      'Active watches without a successful check for their interval plus ten minutes.',
      m.watches.stale,
    ),
  ].join('')
}
