import { createFileRoute } from '@tanstack/react-router'
import { ensureDbReady } from '#/db/migrate'
import { getCuzkMetrics } from '#/lib/cuzk/metrics'
import { metricsAuthorization, renderCuzkMetrics } from '#/lib/cuzk/prometheus'

export const Route = createFileRoute('/api/metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = metricsAuthorization(
          request.headers.get('Authorization'),
        )
        const headers = { 'Cache-Control': 'no-store' }
        if (status !== 200) return new Response(null, { status, headers })
        await ensureDbReady()
        return new Response(renderCuzkMetrics(await getCuzkMetrics()), {
          headers: {
            ...headers,
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          },
        })
      },
    },
  },
})
