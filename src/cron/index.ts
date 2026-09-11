import cron from 'node-cron'
import { recordHeartbeat, trackWorkerJob } from '#/lib/monitoring/worker'
import { ensureDbReady } from '#/db/migrate'
import { pollDueWatches } from './jobs/poll-parcels'
import { refreshCuzkAccount } from '#/lib/cuzk/http'
import { deliverDueNotifications } from '#/lib/notifications/outbox'

export type Job = {
  schedule: string
  name: string
  run: () => Promise<Record<string, number | boolean>>
}

const JOBS: ReadonlyArray<Job> = [
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
]

export async function runOnce(name: string): Promise<void> {
  const job = JOBS.find((j) => j.name === name)
  if (!job) {
    throw new Error(
      `Unknown job "${name}". Known: ${JOBS.map((j) => j.name).join(', ')}`,
    )
  }
  await ensureDbReady()
  await trackWorkerJob(job.name, job.run)
}

export async function startCronWorker() {
  await ensureDbReady()
  await recordHeartbeat(true)
  let writing = false
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
          try {
            await trackWorkerJob(job.name, job.run)
          } catch (err) {
            console.error(`[cron] job ${job.name} failed`, err)
          }
        },
        { noOverlap: true },
      ),
    )
    console.log(`[cron] scheduled ${job.name} (${job.schedule})`)
  }
  return async () => {
    clearInterval(heartbeat)
    await Promise.all(tasks.map((task) => task.destroy()))
  }
}

export { JOBS }
