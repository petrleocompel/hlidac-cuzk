import { getEnv } from '../src/env.ts'

try {
  getEnv()
  const { bootstrapInstance } = await import('../src/db/bootstrap.ts')
  await bootstrapInstance()
} catch (error) {
  // Bootstrap errors are deliberately bounded; provider response bodies are not printed.
  const { ConfigurationError } = await import('../src/env.ts')
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'Bootstrap selhal. Ověřte DB, ADMIN_EMAIL/ADMIN_PASSWORD pro první instalaci a dostupnost nastaveného SSO. Použijte pnpm run doctor.',
  )
  process.exitCode = 1
} finally {
  if (process.env.DATABASE_URL) {
    const { closeDb } = await import('../src/db/index.ts')
    await closeDb()
  }
}
