import cron from 'node-cron'
import { pollDueWatches } from './jobs/poll-parcels'

export type Job = {
  schedule: string
  name: string
  run: () => Promise<void>
}

const JOBS: ReadonlyArray<Job> = [
  {
    schedule: '*/5 * * * *',
    name: 'poll-parcels',
    run: async () => {
      const result = await pollDueWatches()
      console.log('[cron] poll-parcels', result)
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
  await job.run()
}

export async function startCronWorker(): Promise<void> {
  for (const job of JOBS) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron schedule for ${job.name}: ${job.schedule}`)
    }
    cron.schedule(job.schedule, () => {
      job.run().catch((err) => {
        console.error(`[cron] job ${job.name} failed`, err)
      })
    })
    console.log(`[cron] scheduled ${job.name} (${job.schedule})`)
  }
}

export { JOBS }
