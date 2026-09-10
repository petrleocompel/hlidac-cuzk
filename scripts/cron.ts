/**
 * Cron worker entrypoint.
 *
 *   pnpm cron               # long-running scheduler
 *   pnpm cron --once <name> # run a single job and exit
 */
import { runOnce, startCronWorker } from '../src/cron/index.ts'

async function main() {
  const args = process.argv.slice(2)
  const onceIdx = args.indexOf('--once')
  if (onceIdx !== -1) {
    const name = args[onceIdx + 1]
    if (!name) {
      console.error('--once requires a job name')
      process.exit(2)
    }
    await runOnce(name)
    return
  }
  await startCronWorker()
  console.log('[cron] worker running; press Ctrl+C to stop')
}

main().catch((err) => {
  console.error('[cron] fatal', err)
  process.exit(1)
})
