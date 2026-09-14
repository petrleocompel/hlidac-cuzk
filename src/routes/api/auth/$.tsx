import { createFileRoute } from '@tanstack/react-router'
import { handleAuthRequest } from '#/auth/audited'
import { ensureDbReady } from '#/db/migrate'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureDbReady()
        return handleAuthRequest(request)
      },
      POST: async ({ request }) => {
        await ensureDbReady()
        return handleAuthRequest(request)
      },
    },
  },
})
