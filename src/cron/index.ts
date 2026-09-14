import { retainAudit } from '#/lib/audit/retention'
import { runRetention } from '#/lib/maintenance/retention'
import cron from 'node-cron'
import { recordHeartbeat, trackWorkerJob } from '#/lib/monitoring/worker'
import { probeReadiness } from '#/lib/monitoring/readiness'

import { pollDueWatches } from './jobs/poll-parcels'
import { refreshCuzkAccount } from '#/lib/cuzk/http'
import {
  deliverDueDigests,
  deliverDueNotifications,
} from '#/lib/notifications/outbox'

async function requireSchema() {
  if (!(await probeReadiness()))
    throw new Error('Schéma není připravené. Spusťte pnpm bootstrap.')
}

export type Job = {
  schedule: string
  name: string
  run: () => Promise<Record<string, number | boolean>>
}

const JOBS: ReadonlyArray<Job> = [
  {
    schedule: '17 * * * *',
    name: 'retention',
    run: async () => ({
      ...(await runRetention({ apply: true })),
      audit: await retainAudit({ apply: true }),
    }),
  },
  {
    schedule: '0 */6 * * *',
    name: 'refresh-cuzk-account',
    run: async () => {
      const result = await refreshCuzkAccount()
      console.log('[cron] refresh-cuzk-account', result)
      return result
    },
  },
  {
    schedule: '*/5 * * * *',
    name: 'poll-parcels',
    run: async () => {
      const result = await pollDueWatches()
      console.log('[cron] poll-parcels', result)
      return result
    },
  },
  {
    schedule: '* * * * *',
    name: 'deliver-notifications',
    run: async () => {
      const result = await deliverDueNotifications()
      console.log('[cron] deliver-notifications', result)
      return result
    },
  },
  {
    schedule: '*/5 * * * *',
    name: 'deliver-digests',
    run: async () => {
      const result = await deliverDueDigests()
      console.log('[cron] deliver-digests', result)
      return result
    },
  },
]

export async function runOnce(name: string): Promise<void> {
  const job = JOBS.find((j) => j.name === name)
  if (!job) {
    throw new Error(
      `Unknown job "${name}". Known: ${JOBS.map((j) => j.name).join(', ')}`,
    )
  }
  await requireSchema()
  await trackWorkerJob(job.name, job.run)
}

export async function startCronWorker() {
  await requireSchema()
  await recordHeartbeat(true)
  let writing = false
  const active = new Set<Promise<unknown>>()
  let stopping = false
  const heartbeat = setInterval(() => {
    if (writing) return
    writing = true
    void recordHeartbeat()
      .catch((error) => console.error('[cron] heartbeat failed', error))
      .finally(() => {
        writing = false
      })
  }, 30_000)
  const tasks: ReturnType<typeof cron.schedule>[] = []
  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron schedule for ${job.name}: ${job.schedule}`)
    }
    tasks.push(
      cron.schedule(
        job.schedule,
        async () => {
          if (stopping) return
          const running = trackWorkerJob(job.name, job.run)
          active.add(running)
          try {
            await running
          } catch (err) {
            console.error(`[cron] job ${job.name} failed`, err)
          } finally {
            active.delete(running)
          }
        },
        { noOverlap: true },
      ),
    )
    console.log(`[cron] scheduled ${job.name} (${job.schedule})`)
  }
  return async () => {
    stopping = true
    clearInterval(heartbeat)
    await Promise.all(tasks.map((task) => task.destroy()))
    await Promise.allSettled([...active])
  }
}

export { JOBS }
