import { createFileRoute } from '@tanstack/react-router'
import { auth } from '#/auth/server'
import { ensureDbReady } from '#/db/migrate'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await ensureDbReady()
        return auth.handler(request)
      },
      POST: async ({ request }) => {
        await ensureDbReady()
        return auth.handler(request)
      },
    },
  },
})
