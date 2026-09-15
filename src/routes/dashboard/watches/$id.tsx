import { WatchManualLinks } from '#/components/watch/watch-manual-links'
import { getWatchLinks } from '#/server/watch-links'
import { WatchOrganization } from '#/components/watch/watch-organization'
import { WatchMap } from '#/components/watch/watch-map'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Check, Copy, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Switch } from '#/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { WatchNeighborsPanel } from '#/components/watch/watch-neighbors-panel'
import { WatchNotificationRules } from '#/components/watch/watch-notification-rules'
import {
  WatchEventsPanel,
  FocusedWatchEvent,
} from '#/components/watch/watch-events-panel'
import { WatchCheckStatus } from '#/components/watch/watch-check-status'
import { WatchSnapshotPanel } from '#/components/watch/watch-snapshot-panel'
import { WatchObjectPanel } from '#/components/watch/watch-object-panel'
import { WatchLinkedObjects } from '#/components/watch/watch-linked-objects'
import { WatchRizeniPanel } from '#/components/watch/watch-rizeni-panel'
import { formatLvLabel } from '#/lib/cuzk/snapshot'
import { summarizeEvent } from '#/lib/notifications/message'
import {
  isObjectSnapshot,
  objectTypeLabel,
  parseWatchSnapshot,
} from '#/lib/cuzk/object-snapshot'
import { dataAge, formatCheckTime, isWatchStale } from '#/lib/monitoring/freshness'
import {
  deleteWatch,
  getWatch,
  refreshWatch,
  updateWatch,
} from '#/server/watches'
import type { WatchDto } from '#/server/watches'

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
      manualLinks:
        data.watch.objectType === 'parcel'
          ? await getWatchLinks({ data: { id: params.id } })
          : null,
      events: data.events,
      focusedEvents: data.focusedEvents,
      eventTotal: data.eventTotal,
      rizeni: data.rizeni,
      watchedObjects: data.watchedObjects,
      rizeniFollowDays: data.rizeniFollowDays,
      now: Date.now(),
    }
  },
  component: WatchDetailPage,
})

const NOTIFY_KIND_ALL = [
  'new_rizeni',
  'rizeni_progress',
  'lv_change',
  'parcel_attrs',
] as const

function notifiesKind(watch: WatchDto, kind: (typeof NOTIFY_KIND_ALL)[number]) {
  return watch.notifyKinds === null || watch.notifyKinds.includes(kind)
}

function WatchDetailPage() {
  const {
    session,
    watch,
    events,
    focusedEvents,
    eventTotal,
    rizeni,
    rizeniFollowDays,
    watchedObjects,
    manualLinks,
    now,
  } = Route.useLoaderData()
  const { event: focusedId } = Route.useSearch()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState(focusedId ? 'udalosti' : 'prehled')

  const snapshot = parseWatchSnapshot(watch.lastSnapshotJson)
  const parcelSnapshot =
    snapshot && !isObjectSnapshot(snapshot) ? snapshot : null
  const objectSnapshot = snapshot && isObjectSnapshot(snapshot) ? snapshot : null
  const parcelLinks = parcelSnapshot
    ? [
        ...(parcelSnapshot.parcel.stavbaId
          ? [
              {
                objectType: 'stavba' as const,
                isknId: parcelSnapshot.parcel.stavbaId,
                label: `ISKN ${parcelSnapshot.parcel.stavbaId}`,
              },
            ]
          : []),
        ...(parcelSnapshot.parcel.pravoStavbyId
          ? [
              {
                objectType: 'pravo_stavby' as const,
                isknId: parcelSnapshot.parcel.pravoStavbyId,
                label: `ISKN ${parcelSnapshot.parcel.pravoStavbyId}`,
              },
            ]
          : []),
      ]
    : []

  const lv = parcelSnapshot?.parcel.lv ?? objectSnapshot?.object.lv ?? null
  const plombaRizeni = rizeni.filter((r) => r.isPlomba)
  const oldestPlombaDate = plombaRizeni
    .map((r) => r.detail?.datumPrijeti)
    .filter((d): d is string => !!d)
    .sort()[0]

  async function toggleNotifyKind(
    kind: (typeof NOTIFY_KIND_ALL)[number],
    checked: boolean,
  ) {
    const current = watch.notifyKinds ?? [...NOTIFY_KIND_ALL]
    const next = checked
      ? [...new Set([...current, kind])]
      : current.filter((k) => k !== kind)
    await updateWatch({ data: { id: watch.id, notifyKinds: next } })
    await router.invalidate()
  }

  async function handleDelete() {
    if (!confirm('Smazat toto sledování?')) return
    await deleteWatch({ data: { id: watch.id } })
    window.location.href = '/dashboard/watches'
  }

  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        {plombaRizeni.length > 0 ? (
          <Alert variant="warning">
            <AlertTitle>
              Na tomto objektu {plombaRizeni.length === 1 ? 'je' : 'jsou'}{' '}
              {plombaRizeni.length}{' '}
              {plombaRizeni.length === 1 ? 'plomba' : 'plomby'}
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {oldestPlombaDate
                  ? `Nejstarší řízení podáno ${new Date(oldestPlombaDate).toLocaleDateString('cs-CZ')}. `
                  : ''}
                Do dokončení se zapsané údaje mohou změnit.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab('rizeni')}
              >
                Zobrazit řízení
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {watch.label}
              </h1>
              {plombaRizeni.length > 0 ? (
                <Badge
                  variant="outline"
                  className="border-warning-border bg-warning text-warning-foreground"
                >
                  Probíhá řízení
                </Badge>
              ) : watch.enabled ? (
                <Badge
                  variant="outline"
                  className="border-success-border bg-success text-success-foreground"
                >
                  Aktivní
                </Badge>
              ) : (
                <Badge variant="secondary">Pozastaveno</Badge>
              )}
            </div>
            <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{objectTypeLabel(watch.objectType)}</span>
              {watch.kuName ? <span>· {watch.kuName}</span> : null}
              {watch.kuCode ? <span>({watch.kuCode})</span> : null}
              <span>· ISKN {watch.isknId}</span>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-accent"
                onClick={() => {
                  void navigator.clipboard.writeText(watch.isknId)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                kopírovat
              </button>
            </p>
            <p className="text-sm text-muted-foreground">
              {dataAge(watch.lastSuccessfulCheckAt, now)}
              {isWatchStale(watch, now)
                ? ' · Kontroly se zpožďují, zobrazená data mohou být zastaralá.'
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                  setFlash(
                    err instanceof Error ? err.message : 'Načtení selhalo',
                  )
                  await router.invalidate()
                } finally {
                  setRefreshing(false)
                }
              }}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              {refreshing ? 'Načítám…' : 'Zkontrolovat nyní'}
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
              {watch.enabled ? 'Pozastavit' : 'Zapnout'}
            </Button>
            <Button variant="outline" onClick={() => setActiveTab('prehled')}>
              Upravit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Další akce">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void handleDelete()}
                >
                  Smazat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {flash ? (
          <p role="status" className="text-sm text-muted-foreground">
            {flash}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
          {[
            ['List vlastnictví', formatLvLabel(lv)],
            ['Druh pozemku', parcelSnapshot?.parcel.druhPozemku],
            [
              'Výměra',
              parcelSnapshot?.parcel.vymera != null
                ? `${parcelSnapshot.parcel.vymera.toLocaleString('cs')} m²`
                : null,
            ],
            ['Interval kontroly', `${watch.pollIntervalMinutes} min`],
            ['Způsob využití', parcelSnapshot?.parcel.zpusobVyuziti],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 bg-card p-3.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-[15px] font-medium">{value || '—'}</span>
            </div>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="prehled">Přehled</TabsTrigger>
            <TabsTrigger value="rizeni">
              Řízení
              {rizeni.length > 0 ? (
                <Badge
                  variant="outline"
                  className="border-warning-border bg-warning px-1.5 text-warning-foreground"
                >
                  {rizeni.length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="udalosti">Události</TabsTrigger>
            <TabsTrigger value="data">Data z LV</TabsTrigger>
            <TabsTrigger value="sousedi">Sousedi</TabsTrigger>
            {manualLinks ? (
              <TabsTrigger value="vazby">Vazby</TabsTrigger>
            ) : null}
            <TabsTrigger value="notifikace">Notifikace</TabsTrigger>
          </TabsList>

          <TabsContent value="prehled" className="pt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px]">
                      Základní údaje
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3.5 text-sm sm:grid-cols-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">
                        Katastrální území
                      </span>
                      <span>
                        {watch.kuName ?? parcelSnapshot?.parcel.kuNazev ?? '—'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">
                        ISKN id
                      </span>
                      <span>{watch.isknId}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">
                        List vlastnictví
                      </span>
                      <span>{formatLvLabel(lv)}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden p-0">
                  <div className="flex items-center border-b border-border px-5 py-3.5">
                    <span className="flex-1 text-[15px] font-semibold">
                      Posledních 5 událostí
                    </span>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setActiveTab('udalosti')}
                    >
                      Zobrazit vše
                    </button>
                  </div>
                  {events.slice(0, 5).length === 0 ? (
                    <p className="px-5 py-4 text-sm text-muted-foreground">
                      Zatím žádné události.
                    </p>
                  ) : (
                    events.slice(0, 5).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center gap-3 border-b border-border px-5 py-3 text-sm last:border-b-0"
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="min-w-0 flex-1 truncate">
                          {summarizeEvent(event)}
                        </span>
                        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatCheckTime(event.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </Card>

                <WatchOrganization key={watch.id} watch={watch} />
              </div>

              <div className="flex flex-col gap-4">
                <WatchMap watches={[watch]} />
                <WatchCheckStatus watch={watch} now={now} />
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[15px]">Notifikace</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <label className="flex items-center gap-2.5 text-sm">
                      <Switch
                        checked={notifiesKind(watch, 'new_rizeni')}
                        onCheckedChange={(checked) =>
                          void toggleNotifyKind('new_rizeni', checked)
                        }
                      />
                      Nová plomba
                    </label>
                    <label className="flex items-center gap-2.5 text-sm">
                      <Switch
                        checked={notifiesKind(watch, 'lv_change')}
                        onCheckedChange={(checked) =>
                          void toggleNotifyKind('lv_change', checked)
                        }
                      />
                      Změna v LV
                    </label>
                    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                      <Switch checked disabled />
                      Selhání kontroly (vždy zapnuto)
                    </div>
                    <button
                      type="button"
                      className="self-start text-xs text-primary hover:underline"
                      onClick={() => setActiveTab('notifikace')}
                    >
                      Všechna pravidla
                    </button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="rizeni" className="pt-4">
            <WatchRizeniPanel
              watchId={watch.id}
              rizeni={rizeni}
              followDays={rizeniFollowDays}
            />
          </TabsContent>

          <TabsContent value="udalosti" className="flex flex-col gap-4 pt-4">
            {focusedId ? (
              focusedEvents[0] ? (
                <FocusedWatchEvent event={focusedEvents[0]} />
              ) : (
                <p>Událost již není dostupná.</p>
              )
            ) : null}
            <WatchEventsPanel
              watchId={watch.id}
              events={events}
              total={eventTotal}
              historyFrom={watch.createdAt}
            />
          </TabsContent>

          <TabsContent value="data" className="pt-4">
            {objectSnapshot ? (
              <WatchObjectPanel
                snapshot={objectSnapshot}
                lastSuccessfulCheckAt={watch.lastSuccessfulCheckAt}
                lastError={watch.lastError}
                pollIntervalMinutes={watch.pollIntervalMinutes}
                watchedObjects={watchedObjects}
              />
            ) : (
              <div className="space-y-4">
                <WatchSnapshotPanel
                  snapshot={parcelSnapshot}
                  lastSuccessfulCheckAt={watch.lastSuccessfulCheckAt}
                  lastError={watch.lastError}
                  pollIntervalMinutes={watch.pollIntervalMinutes}
                />
                {parcelLinks.length ? (
                  <div className="rounded-xl border p-4">
                    <WatchLinkedObjects
                      links={parcelLinks}
                      watched={watchedObjects}
                      pollIntervalMinutes={watch.pollIntervalMinutes}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sousedi" className="pt-4">
            <WatchNeighborsPanel watchId={watch.id} />
          </TabsContent>

          {manualLinks ? (
            <TabsContent value="vazby" className="pt-4">
              <WatchManualLinks
                key={watch.id + '-links'}
                watchId={watch.id}
                data={manualLinks}
              />
            </TabsContent>
          ) : null}

          <TabsContent value="notifikace" className="pt-4">
            <WatchNotificationRules watch={watch} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  )
}
