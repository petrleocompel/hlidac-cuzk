import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { listWatches } from '#/server/watches'

export const Route = createFileRoute('/dashboard/')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const watches = await listWatches()
    return { session, watches }
  },
  component: DashboardPage,
})

function DashboardPage() {
  const { session, watches } = Route.useLoaderData()

  return (
    <DashboardShell
      email={session.user.email}
      isAdmin={session.user.role === 'admin'}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sledované parcely</h1>
          <p className="text-sm text-muted-foreground">
            Intervalové kontroly plomb v ČÚZK
          </p>
        </div>
        <Button asChild>
          <Link to="/dashboard/watches/new">
            <Plus className="h-4 w-4" />
            Přidat
          </Link>
        </Button>
      </div>

      {watches.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Zatím nic nesledujete</CardTitle>
            <CardDescription>
              Přidejte parcelu podle katastrálního území a parcelního čísla.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/dashboard/watches/new">Nová parcela</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {watches.map((w) => (
            <li key={w.id}>
              <Link
                to="/dashboard/watches/$id"
                params={{ id: w.id }}
                className="block rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{w.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {w.kuName} ({w.kuCode}) ·{' '}
                      {w.parcelSubdivision != null
                        ? `${w.parcelNumber}/${w.parcelSubdivision}`
                        : String(w.parcelNumber)}
                    </p>
                  </div>
                  <span
                    className={
                      w.enabled
                        ? 'rounded-full bg-accent px-2 py-0.5 text-xs font-medium'
                        : 'rounded-full bg-muted px-2 py-0.5 text-xs'
                    }
                  >
                    {w.enabled ? 'aktivní' : 'vypnuto'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  ISKN {w.isknId}
                  {w.lastCheckedAt
                    ? ` · naposledy ${new Date(w.lastCheckedAt).toLocaleString('cs')}`
                    : ' · ještě nekontrolováno'}
                </p>
                {w.lastError ? (
                  <p className="mt-1 text-xs text-destructive">{w.lastError}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardShell>
  )
}
