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
import { lookupAddress, suggestAddress } from '#/server/cuzk'
import type { AddressLookupResult } from '#/server/cuzk'
import { createWatch } from '#/server/watches'
import { WatchLinkedObjects } from '#/components/watch/watch-linked-objects'
import type { WatchedObject } from '#/components/watch/watch-linked-objects'
import { DEFAULT_POLL_MINUTES } from '#/lib/cuzk/policy'
import { objectTypeLabel } from '#/lib/cuzk/object-snapshot'

/** Adds a watch from an address: RÚIAN finds the address place, KN the object. */
export function WatchAddressCard({
  watchedObjects,
}: {
  watchedObjects: WatchedObject[]
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<AddressLookupResult | null>(null)
  const [interval, setIntervalMinutes] = useState(String(DEFAULT_POLL_MINUTES))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced suggestions; the code list stays on the RÚIAN side, not local.
  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setSuggestions([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const hits = await suggestAddress({ data: { query: text } })
        setSuggestions(hits.suggestions)
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  async function resolve(address: string, kod?: number) {
    setPending(true)
    setError(null)
    try {
      const lookup = await lookupAddress({ data: { address, kod } })
      setResult(lookup)
      if (!lookup.places.length)
        setError(
          'RÚIAN tuto adresu nenašel v přesném znění. Vyberte návrh ze seznamu.',
        )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function onSaveBuilding() {
    const building = result?.resolved?.building
    if (!building) return
    setPending(true)
    setError(null)
    try {
      const watch = await createWatch({
        data: {
          objectType: 'stavba',
          isknId: building.isknId,
          pollIntervalMinutes: Number(interval),
        },
      })
      void navigate({ to: '/dashboard/watches/$id', params: { id: watch.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  const resolved = result?.resolved ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Přidat podle adresy</CardTitle>
        <CardDescription>
          Adresu našeptává RÚIAN (služba bez klíče, nespotřebovává rozpočet KN).
          Kód adresního místa se pak přes katastr převede na stavbu; souřadnice
          ani nejbližší bod se za identifikaci objektu nepovažují.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="addressQuery">Adresa</Label>
          <Input
            id="addressQuery"
            autoComplete="off"
            value={query}
            placeholder="Politických vězňů 123, Vejprnice"
            onChange={(event) => {
              setQuery(event.target.value)
              setResult(null)
              setError(null)
            }}
          />
          <p className="text-xs text-muted-foreground" role="status">
            {searching ? 'Hledám v RÚIAN…' : 'Vyberte adresu z nabídky.'}
          </p>
          {suggestions.length ? (
            <ul
              className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-sm"
              aria-label="Nalezené adresy"
            >
              {suggestions.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left hover:bg-accent"
                    onClick={() => {
                      setQuery(text)
                      setSuggestions([])
                      void resolve(text)
                    }}
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {result && result.places.length > 1 && !resolved ? (
          <div className="space-y-2">
            <p className="text-sm">
              Adresa odpovídá více adresním místům. Vyberte to správné:
            </p>
            <ul className="space-y-1 text-sm">
              {result.places.map((place) => (
                <li key={place.kod}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void resolve(place.adresa, place.kod)}
                  >
                    {place.adresa} · kód {place.kod}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {resolved ? (
          <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-sm">
            <p className="font-medium">
              Adresní místo {resolved.place.kod} ·{' '}
              {objectTypeLabel(resolved.building.objectType)}{' '}
              {resolved.building.summary}
            </p>
            <p className="text-muted-foreground">
              ISKN {resolved.building.isknId}
              {resolved.building.kuName
                ? ` · ${resolved.building.kuName}${
                    resolved.building.kuCode
                      ? ` (${resolved.building.kuCode})`
                      : ''
                  }`
                : ''}
              {resolved.building.lvCislo != null
                ? ` · LV ${resolved.building.lvCislo}`
                : ''}{' '}
              · plomby: {resolved.building.plomby}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="space-y-1">
                <Label htmlFor="addressInterval" className="text-xs">
                  Interval (minuty)
                </Label>
                <Input
                  id="addressInterval"
                  type="number"
                  min={5}
                  max={1440}
                  className="w-28"
                  value={interval}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                />
              </div>
              {resolved.building.alreadyWatchedId ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void navigate({
                      to: '/dashboard/watches/$id',
                      params: { id: resolved.building.alreadyWatchedId! },
                    })
                  }
                >
                  Stavbu už sledujete — otevřít
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => void onSaveBuilding()}
                >
                  {pending ? 'Ukládám…' : 'Sledovat stavbu na této adrese'}
                </Button>
              )}
            </div>
            {resolved.links.length ? (
              <WatchLinkedObjects
                links={resolved.links}
                watched={watchedObjects}
                pollIntervalMinutes={Number(interval)}
              />
            ) : (
              <p className="text-muted-foreground">
                ČÚZK u této stavby neuvádí jednotky ani parcely.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
