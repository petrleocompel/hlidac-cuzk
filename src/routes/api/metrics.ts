import { createFileRoute } from '@tanstack/react-router'
import { probeReadiness } from '#/lib/monitoring/readiness'
import {
  getMonitoringStatus,
  renderMonitoringMetrics,
} from '#/lib/monitoring/status'
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
        if (!(await probeReadiness()))
          return new Response(null, { status: 503, headers })
        return new Response(
          renderCuzkMetrics(await getCuzkMetrics()) +
            renderMonitoringMetrics(await getMonitoringStatus()),
          {
            headers: {
              ...headers,
              'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            },
          },
        )
      },
    },
  },
})
