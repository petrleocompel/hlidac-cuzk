import { getEnv } from '../src/env.ts'

try {
  getEnv()
  const { bootstrapInstance } = await import('../src/db/bootstrap.ts')
  await bootstrapInstance()
} catch (error) {
  // Prefer safe Error messages (config, discovery codes). Never dump provider bodies.
  const { ConfigurationError } = await import('../src/env.ts')
  const detail =
    error instanceof ConfigurationError || error instanceof Error
      ? error.message
      : null
  console.error(
    detail ??
      'Bootstrap selhal. Ověřte DB, ADMIN_EMAIL/ADMIN_PASSWORD pro první instalaci a dostupnost nastaveného SSO. Použijte pnpm run doctor.',
  )
  process.exitCode = 1
} finally {
  if (process.env.DATABASE_URL) {
    const { closeDb } = await import('../src/db/index.ts')
    await closeDb()
  }
}
