import { useMemo, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Info, Plus, RefreshCw } from 'lucide-react'
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
import { Progress } from '#/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { parseWatchSnapshot } from '#/lib/cuzk/object-snapshot'
import { formatCheckTime } from '#/lib/monitoring/freshness'
import { getCuzkStatus } from '#/server/cuzk-status'
import { getRecentEvents } from '#/server/dashboard-feed'
import { getNotificationChannelsStatus } from '#/server/notification-channels'
import { listWatches, refreshWatch } from '#/server/watches'
import type { DashboardFeedEvent } from '#/server/dashboard-feed'
import type { NotificationChannelStatus } from '#/server/notification-channels'

export const Route = createFileRoute('/dashboard/')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const [watches, feed, cuzk, channels] = await Promise.all([
      listWatches(),
      getRecentEvents(),
      getCuzkStatus(),
      getNotificationChannelsStatus(),
    ])
    return { session, watches, feed, cuzk, channels, now: Date.now() }
  },
  component: DashboardOverviewPage,
})

const KIND_LABEL: Record<string, string> = {
  new_rizeni: 'plomba',
  rizeni_progress: 'řízení',
  lv_change: 'změna LV',
  parcel_attrs: 'atributy',
  error: 'chyba',
}

const KIND_DOT: Record<string, string> = {
  new_rizeni: 'bg-warning',
  rizeni_progress: 'bg-secondary',
  lv_change: 'bg-primary',
  parcel_attrs: 'bg-primary',
  error: 'bg-destructive',
}

const CHANNEL_LABEL: Record<string, string> = {
  gotify: 'Gotify',
  slack: 'Slack',
  discord: 'Discord',
  ntfy: 'ntfy',
  email: 'E-mail',
}

type FeedFilter = 'all' | 'plomba' | 'lv' | 'error'

function matchesFeedFilter(event: DashboardFeedEvent, filter: FeedFilter) {
  if (filter === 'all') return true
  if (filter === 'plomba')
    return event.kind === 'new_rizeni' || event.kind === 'rizeni_progress'
  if (filter === 'lv')
    return event.kind === 'lv_change' || event.kind === 'parcel_attrs'
  return event.kind === 'error'
}

function DashboardOverviewPage() {
  const { session, watches, feed, cuzk, channels, now } =
    Route.useLoaderData()
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [checkingAll, setCheckingAll] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  const stats = useMemo(() => {
    const paused = watches.filter((w) => !w.enabled).length
    const kuCodes = new Set(
      watches.map((w) => w.kuCode).filter((code): code is string => !!code),
    )
    let plombaCount = 0
    let oldestPodani: string | null = null
    let failed24h = 0
    let soonestNextCheck: string | null = null
    const dayMs = 24 * 60 * 60 * 1000
    for (const w of watches) {
      if (w.enabled) {
        const snapshot = parseWatchSnapshot(w.lastSnapshotJson)
        for (const r of snapshot?.rizeni ?? []) {
          plombaCount += 1
          if (
            r.datumPrijeti &&
            (!oldestPodani || r.datumPrijeti < oldestPodani)
          ) {
            oldestPodani = r.datumPrijeti
          }
        }
        if (
          w.nextCheckAt &&
          (!soonestNextCheck || w.nextCheckAt < soonestNextCheck)
        ) {
          soonestNextCheck = w.nextCheckAt
        }
      }
      if (
        w.lastError &&
        w.lastAttemptAt &&
        now - Date.parse(w.lastAttemptAt) <= dayMs
      ) {
        failed24h += 1
      }
    }
    return {
      total: watches.length,
      paused,
      kuCount: kuCodes.size,
      plombaCount,
      oldestPodani,
      failed24h,
      soonestNextCheck,
    }
  }, [watches, now])

  const filteredFeed = feed.events.filter((e) =>
    matchesFeedFilter(e, feedFilter),
  )

  async function checkAllNow() {
    setCheckingAll(true)
    setActionMessage('')
    try {
      const ids = watches.filter((w) => w.enabled).map((w) => w.id)
      const results = await Promise.allSettled(
        ids.map((id) => refreshWatch({ data: { id } })),
      )
      const changed = results.filter(
        (r) => r.status === 'fulfilled' && r.value.changeCount > 0,
      ).length
      setActionMessage(
        `Zkontrolováno ${ids.length} objektů, ${changed} se změnou.`,
      )
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : 'Kontrola selhala.',
      )
    } finally {
      setCheckingAll(false)
    }
  }

  const firstName = session.user.name.split(' ')[0]
  const quotaUsed = cuzk.limit - cuzk.remaining
  const quotaPercent = cuzk.limit > 0 ? (quotaUsed / cuzk.limit) * 100 : 0
  const resetsAtLabel = new Date(cuzk.resetsAt).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  })

  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Dobrý den, {firstName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Za posledních 7 dní zaznamenáno {feed.last7Days}{' '}
              {feed.last7Days === 1 ? 'změna' : 'změn'} na vašich objektech.
              {stats.soonestNextCheck
                ? ` Další kontrola ${formatCheckTime(stats.soonestNextCheck)}.`
                : ''}
            </p>
          </div>
          <Button asChild>
            <Link to="/dashboard/watches/new">
              <Plus className="size-4" />
              Přidat parcelu
            </Link>
          </Button>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Sledované objekty</CardDescription>
              <CardTitle className="text-3xl tabular-nums tracking-tight">
                {stats.total}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 text-sm">
              <span className="text-muted-foreground">
                z toho {stats.paused} pozastavené
              </span>
              <span className="text-xs text-muted-foreground">
                ve {stats.kuCount}{' '}
                {stats.kuCount === 1 ? 'katastrálním území' : 'katastrálních územích'}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Plomby a řízení</CardDescription>
              <CardTitle className="text-3xl tabular-nums tracking-tight">
                {stats.plombaCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 text-sm">
              <span className="text-muted-foreground">
                {stats.plombaCount > 0 ? 'aktivní na sledovaných objektech' : 'žádné otevřené řízení'}
              </span>
              {stats.oldestPodani ? (
                <span className="text-xs text-muted-foreground">
                  nejstarší podáno{' '}
                  {new Date(stats.oldestPodani).toLocaleDateString('cs-CZ', {
                    day: 'numeric',
                    month: 'numeric',
                  })}
                </span>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Změny za 7 dní</CardDescription>
              <CardTitle className="text-3xl tabular-nums tracking-tight">
                {feed.last7Days}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              předchozí týden {feed.prev7Days}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Selhané kontroly</CardDescription>
              <CardTitle className="text-3xl tabular-nums tracking-tight">
                {stats.failed24h}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-0.5 text-sm">
              <span className="text-muted-foreground">za 24 h</span>
              <span className="text-xs text-muted-foreground">
                {cuzk.blockedUntil
                  ? `ČÚZK nedostupné do ${formatCheckTime(cuzk.blockedUntil)}`
                  : 'ČÚZK dostupné'}
              </span>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-3.5 border-b border-border px-5 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">Co se změnilo</span>
                <span className="text-xs text-muted-foreground">
                  Události napříč všemi objekty
                </span>
              </div>
              <div className="ml-auto flex gap-1.5">
                {(
                  [
                    ['all', 'Vše'],
                    ['plomba', 'Plomby'],
                    ['lv', 'Změny LV'],
                    ['error', 'Chyby'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={feedFilter === value ? 'secondary' : 'ghost'}
                    onClick={() => setFeedFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col">
              {filteredFeed.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  Žádné události neodpovídají filtru.
                </p>
              ) : (
                filteredFeed.map((event) => (
                  <Link
                    key={event.id}
                    to="/dashboard/watches/$id"
                    params={{ id: event.watchId }}
                    search={{ event: event.id }}
                    className="flex items-start gap-3.5 border-b border-border px-5 py-3.5 last:border-b-0 hover:bg-accent"
                  >
                    <div
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${KIND_DOT[event.kind] ?? 'bg-muted-foreground'}`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {event.summary}
                        </span>
                        <Badge variant="outline">
                          {KIND_LABEL[event.kind] ?? event.kind}
                        </Badge>
                      </div>
                      <span className="text-[13px] text-muted-foreground">
                        {event.watchLabel}
                      </span>
                    </div>
                    <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatCheckTime(event.createdAt)}
                    </span>
                  </Link>
                ))
              )}
              <Link
                to="/dashboard/watches"
                className="px-5 py-3 text-sm text-primary hover:underline"
              >
                Zobrazit vše ve Sledování
              </Link>
            </div>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Rychlé akce</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button variant="outline" className="justify-start" asChild>
                  <Link to="/dashboard/watches/new">
                    <Plus className="size-4" />
                    Přidat parcelu podle LV nebo adresy
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  disabled={checkingAll || stats.total === 0}
                  onClick={() => void checkAllNow()}
                >
                  <RefreshCw
                    className={`size-4 ${checkingAll ? 'animate-spin' : ''}`}
                  />
                  {checkingAll
                    ? 'Kontroluji…'
                    : 'Zkontrolovat všechny objekty nyní'}
                </Button>
                <Button variant="outline" className="justify-start" asChild>
                  <Link to="/dashboard/settings">Upravit notifikační pravidla</Link>
                </Button>
                {actionMessage ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {actionMessage}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-[15px]">
                  Denní limit dotazů ČÚZK
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Sdílený denní limit dotazů na ČÚZK pro celou instanci,
                        napříč všemi uživateli.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-lg font-medium tabular-nums">
                    {quotaUsed} / {cuzk.limit}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    obnovení v {resetsAtLabel}
                  </span>
                </div>
                <Progress value={quotaPercent} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center">
                  <CardTitle className="flex-1 text-[15px]">
                    Notifikační kanály
                  </CardTitle>
                  <Link
                    to="/dashboard/settings"
                    className="text-xs text-primary hover:underline"
                  >
                    Spravovat
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {channels.map((channel: NotificationChannelStatus) => (
                  <div
                    key={channel.channel}
                    className="flex items-center gap-2.5"
                  >
                    <div
                      className={`size-1.5 shrink-0 rounded-full ${
                        channel.lastDeliveredAt
                          ? 'bg-success'
                          : channel.configured
                            ? 'border border-muted-foreground'
                            : 'border border-muted-foreground'
                      }`}
                    />
                    <span className="flex-1 text-sm">
                      {CHANNEL_LABEL[channel.channel]}
                    </span>
                    {channel.lastDeliveredAt ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        doručeno{' '}
                        {new Date(channel.lastDeliveredAt).toLocaleDateString(
                          'cs-CZ',
                          { day: 'numeric', month: 'numeric' },
                        )}
                      </span>
                    ) : channel.configured ? (
                      <span className="text-xs text-muted-foreground">
                        zatím nic nedoručeno
                      </span>
                    ) : (
                      <Link
                        to="/dashboard/settings"
                        className="text-xs text-primary hover:underline"
                      >
                        Připojit
                      </Link>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
