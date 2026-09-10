import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({ status: 'ok', service: 'hlidac-cuzk' }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    },
  },
})
