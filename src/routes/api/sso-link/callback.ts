import { createFileRoute } from '@tanstack/react-router'
import { completeSsoLink } from '#/server/sso/link.server'

export const Route = createFileRoute('/api/sso-link/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => completeSsoLink(request),
    },
  },
})
