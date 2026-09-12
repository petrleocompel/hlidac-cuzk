import { getEnv } from '../src/env.ts'
/**
 * Cron worker entrypoint.
 *
 *   pnpm cron               # long-running scheduler
 *   pnpm cron --once <name> # run a single job and exit
 */
import { closeDb } from '../src/db/index.ts'
import { runOnce, startCronWorker } from '../src/cron/index.ts'

async function main() {
  const config = getEnv()
  process.env.BETTER_AUTH_URL = config.BETTER_AUTH_URL
  const args = process.argv.slice(2)
  const onceIdx = args.indexOf('--once')
  if (onceIdx !== -1) {
    const name = args[onceIdx + 1]
    if (!name) {
      console.error('--once requires a job name')
      process.exit(2)
    }
    try {
      await runOnce(name)
    } finally {
      await closeDb()
    }
    return
  }
  const stop = await startCronWorker()
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void stop().finally(async () => {
        await closeDb()
        process.exit(0)
      })
    })
  }
  console.log('[cron] worker running; press Ctrl+C to stop')
}

main().catch(async (err) => {
  console.error('[cron] fatal', err)
  try {
    await closeDb()
  } catch {
    // ignore
  }
  process.exit(1)
})
