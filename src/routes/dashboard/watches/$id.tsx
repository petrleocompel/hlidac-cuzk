import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
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
import { deleteWatch, getWatch, updateWatch } from '#/server/watches'

export const Route = createFileRoute('/dashboard/watches/$id')({
  loader: async ({ params }) => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const data = await getWatch({ data: { id: params.id } })
    return { session, watch: data.watch, events: data.events }
  },
  component: WatchDetailPage,
})

function WatchDetailPage() {
  const { session, watch, events } = Route.useLoaderData()
  const router = useRouter()

  return (
    <DashboardShell
      email={session.user.email}
      isAdmin={session.user.role === 'admin'}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{watch.label}</h1>
          <p className="text-sm text-muted-foreground">
            {watch.kuName} ({watch.kuCode}) · ISKN {watch.isknId}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              await updateWatch({
                data: { id: watch.id, enabled: !watch.enabled },
              })
              await router.invalidate()
            }}
          >
            {watch.enabled ? 'Vypnout' : 'Zapnout'}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!confirm('Smazat toto sledování?')) return
              await deleteWatch({ data: { id: watch.id } })
              window.location.href = '/dashboard'
            }}
          >
            Smazat
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stav</CardTitle>
            <CardDescription>Poslední kontrola a snapshot plomb</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Interval: <strong>{watch.pollIntervalMinutes} min</strong>
            </p>
            <p>
              Naposledy:{' '}
              {watch.lastCheckedAt
                ? new Date(watch.lastCheckedAt).toLocaleString('cs')
                : '—'}
            </p>
            {watch.lastError ? (
              <p className="text-destructive">{watch.lastError}</p>
            ) : null}
            <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(watch.lastSnapshotJson ?? [], null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Události</CardTitle>
            <CardDescription>Změny a chyby</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádné události.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((ev: { id: string; kind: string; createdAt: string; payloadJson: unknown }) => (
                  <li key={ev.id} className="rounded-md border p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{ev.kind}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(ev.createdAt).toLocaleString('cs')}
                      </span>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
                      {JSON.stringify(ev.payloadJson, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
