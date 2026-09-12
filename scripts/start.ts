import { getEnv } from '../src/env.ts'
import { probeReadiness } from '../src/lib/monitoring/readiness.ts'

try {
  const config = getEnv()
  // Resolve PUBLIC_URL consistently for auth consumers using process.env.
  process.env.BETTER_AUTH_URL = config.BETTER_AUTH_URL
  if (!(await probeReadiness(config.DATABASE_URL)))
    throw new Error(
      'Databáze nebo schéma nejsou připravené. Spusťte pnpm bootstrap.',
    )
  await import(new URL('../.output/server/index.mjs', import.meta.url).href)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Spuštění selhalo.')
  process.exitCode = 1
}
