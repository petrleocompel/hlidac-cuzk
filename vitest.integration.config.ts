import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const databaseUrl = process.env.TEST_DATABASE_URL
if (
  !databaseUrl ||
  !new URL(databaseUrl).pathname.startsWith('/hlidac_test_')
) {
  throw new Error(
    'TEST_DATABASE_URL must point to a disposable database named hlidac_test_*.',
  )
}

export default defineConfig({
  resolve: { alias: { '#': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: databaseUrl,
      CUZK_API_KEY: 'integration-test-only',
      CUZK_MIN_REQUEST_INTERVAL_MS: '0',
      SSO_BOOTSTRAP_ENABLED: 'false',
    },
  },
})
