import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { WatchImportCard } from '#/components/watch/watch-import-card'
import { WatchObjectFormCard } from '#/components/watch/watch-object-form-card'
import { lookupParcel, searchKu } from '#/server/cuzk'
import type { ParcelLookup } from '#/lib/cuzk/watch-create'
import { createWatch } from '#/server/watches'
import { DEFAULT_POLL_MINUTES } from '#/lib/cuzk/policy'
import { getNewWatchDefaults } from '#/server/watch-defaults'

export const Route = createFileRoute('/dashboard/watches/new')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session, defaults: await getNewWatchDefaults() }
  },
  component: NewWatchPage,
})

type KuHit = { kod: string; nazev: string }

function NewWatchPage() {
  const { session, defaults } = Route.useLoaderData()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [kuQuery, setKuQuery] = useState(defaults.demoKuName)
  const [ku, setKu] = useState<KuHit | null>(
    defaults.demoKuCode && defaults.demoKuName
      ? { kod: defaults.demoKuCode, nazev: defaults.demoKuName }
      : null,
  )
  const [kuHits, setKuHits] = useState<KuHit[]>([])
  const [kuSearching, setKuSearching] = useState(false)
  const [parcel, setParcel] = useState(defaults.demoParcel)
  const [label, setLabel] = useState('')
  const [interval, setIntervalMinutes] = useState(String(DEFAULT_POLL_MINUTES))
  const [verified, setVerified] = useState<ParcelLookup | null>(null)

  // Suggestions come from a server-cached code list, not from a ČÚZK call per key.
  useEffect(() => {
    const query = kuQuery.trim()
    if (query.length < 2 || query === ku?.nazev || query === ku?.kod) {
      setKuHits([])
      return
    }
    const timer = setTimeout(async () => {
      setKuSearching(true)
      try {
        setKuHits(await searchKu({ data: { query } }))
      } catch {
        setKuHits([])
      } finally {
        setKuSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [kuQuery, ku])

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ku) {
      setError('Nejprve vyberte katastrální území ze seznamu.')
      return
    }
    setPending(true)
    setError(null)
    setVerified(null)
    try {
      const hit = await lookupParcel({
        data: { kuCode: ku.kod, parcel },
      })
      setVerified(hit)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function onSave() {
    if (!verified) return
    setPending(true)
    setError(null)
    try {
      const watch = await createWatch({
        data: {
          isknId: verified.isknId,
          label: label.trim() || undefined,
          pollIntervalMinutes: Number(interval),
        },
      })
      void navigate({ to: '/dashboard/watches/$id', params: { id: watch.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <div className="mx-auto max-w-xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Nová sledovaná parcela</CardTitle>
            <CardDescription>
              Katastrální území stačí napsat i bez diakritiky, nebo zadat jeho
              kód. Parcelní číslo zadejte jako 1133/77, 1133 nebo st. 25. Před
              uložením výsledek potvrdíte podle odpovědi ČÚZK.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onVerify}>
              <div className="space-y-2">
                <Label htmlFor="kuQuery">Katastrální území</Label>
                <Input
                  id="kuQuery"
                  name="kuQuery"
                  autoComplete="off"
                  required
                  value={kuQuery}
                  placeholder="Vejprnice nebo 777552"
                  onChange={(event) => {
                    setKuQuery(event.target.value)
                    setKu(null)
                    setVerified(null)
                  }}
                />
                <p className="text-xs text-muted-foreground" role="status">
                  {ku
                    ? `Vybráno: ${ku.nazev} (${ku.kod})`
                    : kuSearching
                      ? 'Hledám…'
                      : 'Vyberte území z nabídky; kód i název se přeberou z ČÚZK.'}
                </p>
                {kuHits.length ? (
                  <ul
                    className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-sm"
                    aria-label="Nalezená katastrální území"
                  >
                    {kuHits.map((hit) => (
                      <li key={hit.kod}>
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1 text-left hover:bg-accent"
                          onClick={() => {
                            setKu(hit)
                            setKuQuery(hit.nazev)
                            setKuHits([])
                          }}
                        >
                          {hit.nazev}{' '}
                          <span className="text-muted-foreground">
                            ({hit.kod})
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="parcel">Parcelní číslo</Label>
                  <Input
                    id="parcel"
                    name="parcel"
                    required
                    value={parcel}
                    placeholder="1133/77"
                    onChange={(event) => {
                      setParcel(event.target.value)
                      setVerified(null)
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Předpona st. označuje stavební parcelu.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pollIntervalMinutes">Interval (minuty)</Label>
                  <Input
                    id="pollIntervalMinutes"
                    name="pollIntervalMinutes"
                    type="number"
                    min={5}
                    max={1440}
                    value={interval}
                    onChange={(event) => setIntervalMinutes(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Denní kontrola šetří společný rozpočet 500 volání ČÚZK denně.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="label">Vlastní název (nepovinné)</Label>
                <Input
                  id="label"
                  name="label"
                  value={label}
                  placeholder="Převezme se z odpovědi ČÚZK"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              {verified ? (
                <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
                  <p className="font-medium">Ověřeno v ČÚZK</p>
                  <p>
                    {verified.kuName} ({verified.kuCode}) ·{' '}
                    {verified.parcelNumber}
                    {verified.parcelSubdivision != null
                      ? `/${verified.parcelSubdivision}`
                      : ''}{' '}
                    · ISKN {verified.isknId}
                  </p>
                  <p className="text-muted-foreground">
                    {verified.typParcely ?? '—'} ·{' '}
                    {verified.druhCislovani === 1 ? 'stavební' : 'pozemková'} ·
                    výměra{' '}
                    {verified.vymera != null
                      ? `${verified.vymera.toLocaleString('cs')} m²`
                      : 'neuvedena'}
                    {verified.druhPozemku ? ` · ${verified.druhPozemku}` : ''}
                    {verified.lvCislo != null ? ` · LV ${verified.lvCislo}` : ''}
                    {verified.plomby != null
                      ? ` · plomby: ${verified.plomby}`
                      : ''}
                  </p>
                  {verified.alreadyWatchedId ? (
                    <p className="text-destructive">
                      Tuto parcelu už sledujete. Otevřete existující sledování.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="outline" disabled={pending}>
                  {pending && !verified ? 'Ověřuji v ČÚZK…' : 'Ověřit parcelu'}
                </Button>
                <Button
                  type="button"
                  disabled={
                    pending || !verified || Boolean(verified.alreadyWatchedId)
                  }
                  onClick={() => void onSave()}
                >
                  {pending && verified ? 'Ukládám…' : 'Uložit sledování'}
                </Button>
                {verified?.alreadyWatchedId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      void navigate({
                        to: '/dashboard/watches/$id',
                        params: { id: verified.alreadyWatchedId! },
                      })
                    }
                  >
                    Otevřít existující
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <WatchObjectFormCard />

        <WatchImportCard />
      </div>
    </DashboardShell>
  )
}
