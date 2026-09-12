import { defineConfig } from 'vitest/config'
import integration from './vitest.integration.config.ts'

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    include: ['tests/backup/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
