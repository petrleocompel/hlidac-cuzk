import { getEnv } from '../src/env.ts'
import { closeDb } from '../src/db/index.ts'
import { runRetention } from '../src/lib/maintenance/retention.ts'
import { probeReadiness } from '../src/lib/monitoring/readiness.ts'

try {
  getEnv()
  if (!(await probeReadiness()))
    throw new Error('Schéma není připravené. Spusťte bootstrap.')
  const args = process.argv.slice(2)
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  )
    throw new Error('Použijte --dry-run (výchozí) nebo --apply.')
  console.log(
    JSON.stringify(await runRetention({ apply: args.includes('--apply') })),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Retence selhala.')
  process.exitCode = 1
} finally {
  await closeDb()
}
