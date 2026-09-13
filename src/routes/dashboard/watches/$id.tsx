import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import { WatchNotificationRules } from '#/components/watch/watch-notification-rules'
import {
  WatchEventsPanel,
  FocusedWatchEvent,
} from '#/components/watch/watch-events-panel'
import { WatchCheckStatus } from '#/components/watch/watch-check-status'
import { WatchSnapshotPanel } from '#/components/watch/watch-snapshot-panel'
import { WatchRizeniPanel } from '#/components/watch/watch-rizeni-panel'
import { parseSnapshot } from '#/lib/cuzk/snapshot'
import {
  deleteWatch,
  getWatch,
  refreshWatch,
  updateWatch,
} from '#/server/watches'

export const Route = createFileRoute('/dashboard/watches/$id')({
  validateSearch: (search: Record<string, unknown>): { event?: string } => ({
    event:
      typeof search.event === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        search.event,
      )
        ? search.event
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ event: search.event }),
  loader: async ({ params, deps }) => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const data = await getWatch({
      data: { id: params.id, eventId: deps.event },
    })
    return {
      session,
      watch: data.watch,
      events: data.events,
      focusedEvents: data.focusedEvents,
      eventTotal: data.eventTotal,
      rizeni: data.rizeni,
      rizeniFollowDays: data.rizeniFollowDays,
      now: Date.now(),
    }
  },
  component: WatchDetailPage,
})

function WatchDetailPage() {
  const {
    session,
    watch,
    events,
    focusedEvents,
    eventTotal,
    rizeni,
    rizeniFollowDays,
    now,
  } = Route.useLoaderData()
  const { event: focusedId } = Route.useSearch()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const snapshot = parseSnapshot(watch.lastSnapshotJson)

  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {watch.label}
          </h1>
          <p className="text-sm text-muted-foreground">
            {watch.kuName} ({watch.kuCode}) · ISKN {watch.isknId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true)
              setFlash(null)
              try {
                const result = await refreshWatch({ data: { id: watch.id } })
                setFlash(
                  result.pollStatus === 'cooldown'
                    ? 'Ruční kontrolu lze spustit nejvýše jednou za 5 minut.'
                    : result.pollStatus === 'busy'
                      ? 'Kontrola této parcely už probíhá. Za chvíli obnovte stav.'
                      : result.pollStatus === 'superseded'
                        ? 'Výsledek této kontroly už není aktuální. Obnovte stav parcely.'
                        : result.changeCount > 0
                          ? `Zachyceno změn: ${result.changeCount}. Upozornění ve frontě: ${result.queued}.`
                          : 'Načteno — bez změn',
                )
                await router.invalidate()
              } catch (err) {
                setFlash(err instanceof Error ? err.message : 'Načtení selhalo')
                await router.invalidate()
              } finally {
                setRefreshing(false)
              }
            }}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
            />
            {refreshing ? 'Načítám…' : 'Načíst teď'}
          </Button>
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

      {flash ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {flash}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
        {focusedId ? (
          focusedEvents[0] ? (
            <FocusedWatchEvent event={focusedEvents[0]} />
          ) : (
            <p>Událost již není dostupná.</p>
          )
        ) : null}
        <WatchNotificationRules watch={watch} />
        <WatchCheckStatus watch={watch} now={now} />
        <WatchSnapshotPanel
          snapshot={snapshot}
          lastSuccessfulCheckAt={watch.lastSuccessfulCheckAt}
          lastError={watch.lastError}
          pollIntervalMinutes={watch.pollIntervalMinutes}
        />
        <WatchRizeniPanel
          watchId={watch.id}
          rizeni={rizeni}
          followDays={rizeniFollowDays}
        />
        <WatchEventsPanel
          watchId={watch.id}
          events={events}
          total={eventTotal}
          historyFrom={watch.createdAt}
        />
      </div>
    </DashboardShell>
  )
}
