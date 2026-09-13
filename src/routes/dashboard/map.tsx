import { createFileRoute, redirect } from '@tanstack/react-router'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { WatchMap } from '#/components/watch/watch-map'
import { listWatches } from '#/server/watches'

export const Route = createFileRoute('/dashboard/map')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session, watches: await listWatches() }
  },
  component: Page,
})
function Page() {
  const { session, watches } = Route.useLoaderData()
  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <h1 className="mb-4 text-2xl font-semibold">Mapa sledovaných objektů</h1>
      <WatchMap watches={watches} />
    </DashboardShell>
  )
}
