import { createFileRoute } from '@tanstack/react-router'
import { probeReadiness } from '#/lib/monitoring/readiness'

export const Route = createFileRoute('/readyz')({
  server: {
    handlers: {
      GET: async () => {
        const ready = await probeReadiness()
        return Response.json(
          { status: ready ? 'ready' : 'unavailable' },
          {
            status: ready ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        )
      },
    },
  },
})
