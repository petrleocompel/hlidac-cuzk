import { createFileRoute } from '@tanstack/react-router'
import { completeSsoLink } from '#/server/sso/link'

export const Route = createFileRoute('/api/sso-link/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => completeSsoLink(request),
    },
  },
})
