import { useState } from 'react'
import { Input } from '#/components/ui/input'
import { bulkUpdateWatches } from '#/server/organization'
import { EMPTY_WATCH_FILTERS, matchesWatch } from '#/lib/watch-organization'
import type { WatchFilters } from '#/lib/watch-organization'
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
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
import { formatLvLabel, formatParcelNumber } from '#/lib/cuzk/snapshot'
import {
  describeWatchObject,
  isObjectSnapshot,
  parseWatchSnapshot,
} from '#/lib/cuzk/object-snapshot'
import {
  dataAge,
  formatCheckTime,
  isWatchStale,
} from '#/lib/monitoring/freshness'
import { listWatches } from '#/server/watches'

export const Route = createFileRoute('/dashboard/watches/')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const watches = await listWatches()
    return { session, watches, now: Date.now() }
  },
  component: WatchesListPage,
})

function WatchesListPage() {
  const { session, watches, now } = Route.useLoaderData()
  const router = useRouter()
  const [filters, setFilters] = useState<WatchFilters>(EMPTY_WATCH_FILTERS)
  const [selected, setSelected] = useState<string[]>([])
  const [interval, setInterval] = useState('1440')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const filtered = watches.filter((w) => matchesWatch(w, filters))
  const selectedVisible = selected.filter((id) =>
    filtered.some((w) => w.id === id),
  )
  const kuChoices = [
    ...new Map(
      watches
        .filter((w) => w.kuCode)
        .map((w) => [w.kuCode!, w.kuName || w.kuCode!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], 'cs'))
  const tagChoices = [...new Set(watches.flatMap((w) => w.tags))].sort((a, b) =>
    a.localeCompare(b, 'cs'),
  )
  const changeFilter = (next: Partial<WatchFilters>) => {
    setFilters({ ...filters, ...next })
    setSelected([])
  }
  const applyBatch = async (change: {
    enabled?: boolean
    pollIntervalMinutes?: number
  }) => {
    setBusy(true)
    setFeedback('')
    try {
      const result = await bulkUpdateWatches({
        data: { ids: selectedVisible, ...change },
      })
      setFeedback(`Upraveno sledování: ${result.updated}.`)
      setSelected([])
      await router.invalidate()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Změna selhala.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sledované objekty
          </h1>
          <p className="text-sm text-muted-foreground">
            Uložená data z ČÚZK, plomby a indikátory změny LV
          </p>
        </div>
        <Button asChild>
          <Link to="/dashboard/watches/new">
            <Plus className="h-4 w-4" />
            Přidat
          </Link>
        </Button>
      </div>

      {watches.length > 0 && (
        <section
          className="mb-4 space-y-3 rounded-xl border bg-card p-4"
          aria-label="Hledání a hromadné změny"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              Hledat v názvu, poznámce nebo identifikaci
              <Input
                value={filters.query}
                maxLength={200}
                onChange={(e) => changeFilter({ query: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Katastrální území
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={filters.ku}
                onChange={(e) => changeFilter({ ku: e.target.value })}
              >
                <option value="">Všechna KÚ</option>
                {kuChoices.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name} ({code})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Číslo LV
              <Input
                inputMode="numeric"
                value={filters.lv}
                onChange={(e) => changeFilter({ lv: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Stav
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={filters.status}
                onChange={(e) =>
                  changeFilter({
                    status: e.target.value as WatchFilters['status'],
                  })
                }
              >
                <option value="all">Všechny stavy</option>
                <option value="active">Aktivní</option>
                <option value="paused">Pozastavené</option>
                <option value="error">Poslední kontrola selhala</option>
                <option value="plomba">Se známou plombou</option>
              </select>
            </label>
            <label className="text-sm">
              Štítek
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={filters.tag}
                onChange={(e) => changeFilter({ tag: e.target.value })}
              >
                <option value="">Všechny štítky</option>
                {tagChoices.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p role="status" className="text-sm">
            Zobrazeno {filtered.length} z {watches.length}. Číslo LV je převzaté
            z posledního snapshotu; mezi KÚ není jedinečné.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  filtered.length > 0 &&
                  selectedVisible.length === Math.min(filtered.length, 100)
                }
                disabled={busy || !filtered.length}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? filtered.slice(0, 100).map((w) => w.id)
                      : [],
                  )
                }
              />
              Vybrat zobrazené (nejvýše 100)
            </label>
            <span className="text-sm">Vybráno: {selectedVisible.length}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selectedVisible.length}
              onClick={() => void applyBatch({ enabled: false })}
            >
              Pozastavit vybrané
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selectedVisible.length}
              onClick={() => void applyBatch({ enabled: true })}
            >
              Obnovit vybrané
            </Button>
            <label className="flex items-center gap-2 text-sm">
              Interval (min)
              <Input
                type="number"
                min={5}
                max={1440}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-24"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                !selectedVisible.length ||
                !Number.isInteger(Number(interval)) ||
                Number(interval) < 5 ||
                Number(interval) > 1440
              }
              onClick={() =>
                void applyBatch({ pollIntervalMinutes: Number(interval) })
              }
            >
              Změnit interval vybraných
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Kratší interval zvyšuje spotřebu společného limitu 500 volání denně.
            Změna filtrů zruší výběr. Pozastavení zastaví budoucí kontroly; již
            zachycená upozornění zůstávají ve frontě.
          </p>
          <p role="status" className="text-sm">
            {feedback}
          </p>
        </section>
      )}
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
          {filtered.length === 0 && (
            <li>Žádné sledování neodpovídá filtrům.</li>
          )}
          {filtered.map((w) => {
            const stored = parseWatchSnapshot(w.lastSnapshotJson)
            const snapshot = stored && !isObjectSnapshot(stored) ? stored : null
            const object = stored && isObjectSnapshot(stored) ? stored : null
            const plomby = stored?.rizeni.length ?? 0
            const vklady = stored?.rizeni.filter((r) => r.isVklad).length ?? 0
            return (
              <li key={w.id} className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedVisible.includes(w.id)}
                    disabled={
                      busy ||
                      (!selectedVisible.includes(w.id) &&
                        selectedVisible.length >= 100)
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selectedVisible, w.id]
                          : selectedVisible.filter((id) => id !== w.id),
                      )
                    }
                  />
                  Vybrat {w.label}
                </label>
                <Link
                  to="/dashboard/watches/$id"
                  params={{ id: w.id }}
                  className="block rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-primary/40 dark:shadow-none"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{w.label}</p>
                      {w.tags.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Štítky: {w.tags.join(', ')}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {describeWatchObject(w)}
                      </p>
                    </div>
                    <Badge variant={w.enabled ? 'secondary' : 'outline'}>
                      {w.enabled ? 'aktivní' : 'vypnuto'}
                    </Badge>
                  </div>

                  {object ? (
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <p>
                        <span className="text-muted-foreground">LV </span>
                        {formatLvLabel(object.object.lv)}
                      </p>
                      <p className="sm:col-span-2">
                        <span className="text-muted-foreground">Objekt </span>
                        {object.object.summary}
                      </p>
                    </div>
                  ) : null}

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
                    <span>
                      · poslední úspěch{' '}
                      {formatCheckTime(w.lastSuccessfulCheckAt)}
                    </span>
                    <span>· {dataAge(w.lastSuccessfulCheckAt, now)}</span>
                    {isWatchStale(w, now) && (
                      <Badge variant="destructive">Kontroly se zpožďují</Badge>
                    )}
                    {plomby > 0 ? (
                      <Badge variant="destructive">{plomby} plomb</Badge>
                    ) : null}
                    {vklady > 0 ? <Badge>vklad {vklady}</Badge> : null}
                  </div>
                  {w.lastError ? (
                    <p className="mt-1 text-xs text-destructive">
                      {w.lastError}
                    </p>
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
