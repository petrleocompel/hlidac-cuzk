import { createFileRoute } from '@tanstack/react-router'
import { metricsAuthorization } from '#/lib/cuzk/prometheus'
import { probeReadiness } from '#/lib/monitoring/readiness'
import { getMonitoringStatus } from '#/lib/monitoring/status'

export const Route = createFileRoute('/api/monitoring')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const status = metricsAuthorization(
          request.headers.get('Authorization'),
        )
        const headers = { 'Cache-Control': 'no-store' }
        if (status !== 200) return new Response(null, { status, headers })
        if (!(await probeReadiness()))
          return Response.json(
            { healthy: false, databaseReady: false },
            { status: 503, headers },
          )
        try {
          const health = await getMonitoringStatus()
          return Response.json(health, {
            status: health.healthy ? 200 : 503,
            headers,
          })
        } catch {
          return Response.json(
            { healthy: false, databaseReady: false },
            { status: 503, headers },
          )
        }
      },
    },
  },
})
