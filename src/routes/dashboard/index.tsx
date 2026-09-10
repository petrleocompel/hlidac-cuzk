import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  formatLvLabel,
  formatParcelNumber,
  parseSnapshot,
} from '#/lib/cuzk/snapshot'
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
      user={session.user}
      isAdmin={session.user.role === 'admin'}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sledované parcely
          </h1>
          <p className="text-sm text-muted-foreground">
            Aktuální data z ČÚZK, plomby a indikátory změny LV
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
          {watches.map((w) => {
            const snapshot = parseSnapshot(w.lastSnapshotJson)
            const plomby = snapshot?.rizeni.length ?? 0
            const vklady = snapshot?.rizeni.filter((r) => r.isVklad).length ?? 0
            return (
              <li key={w.id}>
                <Link
                  to="/dashboard/watches/$id"
                  params={{ id: w.id }}
                  className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 dark:shadow-none"
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
                    <Badge variant={w.enabled ? 'secondary' : 'outline'}>
                      {w.enabled ? 'aktivní' : 'vypnuto'}
                    </Badge>
                  </div>

                  {snapshot && snapshot.parcel.id ? (
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <p>
                        <span className="text-muted-foreground">LV </span>
                        {formatLvLabel(snapshot.parcel.lv)}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Druh </span>
                        {snapshot.parcel.druhPozemku ?? '—'}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Výměra </span>
                        {snapshot.parcel.vymera != null
                          ? `${snapshot.parcel.vymera.toLocaleString('cs')} m²`
                          : '—'}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>ISKN {w.isknId}</span>
                    {snapshot && snapshot.parcel.id ? (
                      <span>· parcela {formatParcelNumber(snapshot)}</span>
                    ) : null}
                    {w.lastCheckedAt ? (
                      <span>
                        · naposledy{' '}
                        {new Date(w.lastCheckedAt).toLocaleString('cs')}
                      </span>
                    ) : (
                      <span>· ještě nekontrolováno</span>
                    )}
                    {plomby > 0 ? (
                      <Badge variant="destructive">{plomby} plomb</Badge>
                    ) : null}
                    {vklady > 0 ? <Badge>vklad {vklady}</Badge> : null}
                  </div>
                  {w.lastError ? (
                    <p className="mt-1 text-xs text-destructive">{w.lastError}</p>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </DashboardShell>
  )
}
