import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { lookupBuilding, lookupObject, searchCastiObci } from '#/server/cuzk'
import { createWatch } from '#/server/watches'
import type { ObjectLookup } from '#/lib/cuzk/watch-create'
import { DEFAULT_POLL_MINUTES } from '#/lib/cuzk/policy'
import { objectTypeLabel } from '#/lib/cuzk/object-snapshot'

type ObjectKind = 'stavba' | 'jednotka' | 'pravo_stavby'
type CastObceHit = { kod: string; nazev: string; obec: string | null }

/** Buildings and units are searched through RÚIAN parts of a municipality. */
export function WatchObjectFormCard() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<ObjectKind>('stavba')
  const [query, setQuery] = useState('')
  const [castObce, setCastObce] = useState<CastObceHit | null>(null)
  const [hits, setHits] = useState<CastObceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [typStavby, setTypStavby] = useState('1')
  const [cisloDomovni, setCisloDomovni] = useState('')
  const [cisloJednotky, setCisloJednotky] = useState('')
  const [isknId, setIsknId] = useState('')
  const [label, setLabel] = useState('')
  const [interval, setIntervalMinutes] = useState(String(DEFAULT_POLL_MINUTES))
  const [verified, setVerified] = useState<ObjectLookup | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2 || text === castObce?.nazev) {
      setHits([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        setHits(await searchCastiObci({ data: { query: text } }))
      } catch {
        setHits([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, castObce])

  function reset() {
    setVerified(null)
    setError(null)
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setVerified(null)
    try {
      if (kind === 'pravo_stavby') {
        setVerified(
          await lookupObject({
            data: { objectType: 'pravo_stavby', isknId: isknId.trim() },
          }),
        )
      } else {
        if (!castObce) throw new Error('Nejprve vyberte část obce ze seznamu.')
        setVerified(
          await lookupBuilding({
            data: {
              objectType: kind,
              kodCastiObce: Number(castObce.kod),
              typStavby: Number(typStavby),
              cisloDomovni: Number(cisloDomovni),
              cisloJednotky:
                kind === 'jednotka' ? Number(cisloJednotky) : undefined,
            },
          }),
        )
      }
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
          objectType: verified.objectType,
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
    <Card>
      <CardHeader>
        <CardTitle>Stavba, jednotka nebo právo stavby</CardTitle>
        <CardDescription>
          Stavbu i jednotku ČÚZK vyhledává podle části obce (kód RÚIAN), typu
          čísla a čísla domovního; u jednotky navíc podle čísla jednotky. Právo
          stavby se přidává podle ISKN id z detailu parcely nebo stavby. Sleduje
          se jen to, co daný registr skutečně vrací.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onVerify}>
          <div className="space-y-2">
            <Label htmlFor="objectKind">Typ objektu</Label>
            <select
              id="objectKind"
              value={kind}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => {
                setKind(event.target.value as ObjectKind)
                reset()
              }}
            >
              <option value="stavba">{objectTypeLabel('stavba')}</option>
              <option value="jednotka">{objectTypeLabel('jednotka')}</option>
              <option value="pravo_stavby">
                {objectTypeLabel('pravo_stavby')}
              </option>
            </select>
          </div>

          {kind === 'pravo_stavby' ? (
            <div className="space-y-2">
              <Label htmlFor="pravoIsknId">ISKN id práva stavby</Label>
              <Input
                id="pravoIsknId"
                required
                inputMode="numeric"
                value={isknId}
                placeholder="např. 1234567890"
                onChange={(event) => {
                  setIsknId(event.target.value)
                  reset()
                }}
              />
              <p className="text-xs text-muted-foreground">
                Najdete jej v detailu parcely nebo stavby, která právo stavby
                eviduje. Vyhledání podle čísla LV ČÚZK v tomto API nenabízí.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="castObce">Část obce (RÚIAN)</Label>
                <Input
                  id="castObce"
                  autoComplete="off"
                  required
                  value={query}
                  placeholder="Vejprnice nebo 400611"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setCastObce(null)
                    reset()
                  }}
                />
                <p className="text-xs text-muted-foreground" role="status">
                  {castObce
                    ? `Vybráno: ${castObce.nazev} (${castObce.kod})`
                    : searching
                      ? 'Hledám…'
                      : 'Kód části obce je z RÚIAN, není to kód katastrálního území.'}
                </p>
                {hits.length ? (
                  <ul
                    className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-sm"
                    aria-label="Nalezené části obce"
                  >
                    {hits.map((hit) => (
                      <li key={hit.kod}>
                        <button
                          type="button"
                          className="w-full rounded px-2 py-1 text-left hover:bg-accent"
                          onClick={() => {
                            setCastObce(hit)
                            setQuery(hit.nazev)
                            setHits([])
                            reset()
                          }}
                        >
                          {hit.nazev}
                          {hit.obec ? `, ${hit.obec}` : ''}{' '}
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
                  <Label htmlFor="typStavby">Typ čísla stavby</Label>
                  <select
                    id="typStavby"
                    value={typStavby}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    onChange={(event) => {
                      setTypStavby(event.target.value)
                      reset()
                    }}
                  >
                    <option value="1">1 — číslo popisné</option>
                    <option value="2">2 — číslo evidenční</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cisloDomovni">Číslo domovní</Label>
                  <Input
                    id="cisloDomovni"
                    type="number"
                    min={1}
                    max={99999}
                    required
                    value={cisloDomovni}
                    onChange={(event) => {
                      setCisloDomovni(event.target.value)
                      reset()
                    }}
                  />
                </div>
              </div>
              {kind === 'jednotka' ? (
                <div className="space-y-2">
                  <Label htmlFor="cisloJednotky">Číslo jednotky</Label>
                  <Input
                    id="cisloJednotky"
                    type="number"
                    min={0}
                    required
                    value={cisloJednotky}
                    onChange={(event) => {
                      setCisloJednotky(event.target.value)
                      reset()
                    }}
                  />
                </div>
              ) : null}
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="objectInterval">Interval (minuty)</Label>
              <Input
                id="objectInterval"
                type="number"
                min={5}
                max={1440}
                value={interval}
                onChange={(event) => setIntervalMinutes(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="objectLabel">Vlastní název (nepovinné)</Label>
              <Input
                id="objectLabel"
                value={label}
                placeholder="Převezme se z odpovědi ČÚZK"
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {verified ? (
            <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-sm">
              <p className="font-medium">
                Ověřeno v ČÚZK: {objectTypeLabel(verified.objectType)}{' '}
                {verified.summary}
              </p>
              <p className="text-muted-foreground">
                ISKN {verified.isknId}
                {verified.kuName
                  ? ` · ${verified.kuName}${verified.kuCode ? ` (${verified.kuCode})` : ''}`
                  : ''}
                {verified.lvCislo != null ? ` · LV ${verified.lvCislo}` : ''} ·
                plomby: {verified.plomby}
              </p>
              <dl className="grid gap-1 sm:grid-cols-2">
                {verified.attrs.map((attr) => (
                  <div key={attr.field} className="flex gap-1">
                    <dt className="text-muted-foreground">{attr.label}:</dt>
                    <dd>{attr.value}</dd>
                  </div>
                ))}
              </dl>
              {verified.alreadyWatchedId ? (
                <p className="text-destructive">
                  Tento objekt už sledujete. Otevřete existující sledování.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline" disabled={pending}>
              {pending && !verified ? 'Ověřuji v ČÚZK…' : 'Ověřit objekt'}
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
  )
}
