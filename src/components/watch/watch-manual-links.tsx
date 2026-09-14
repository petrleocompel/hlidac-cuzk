import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Input } from '#/components/ui/input'
import { addWatchLink, removeWatchLink } from '#/server/watch-links'
import type { readWatchLinks } from '#/lib/watches/links'

export function WatchManualLinks({
  watchId,
  data,
}: {
  watchId: string
  data: Awaited<ReturnType<typeof readWatchLinks>>
}) {
  const router = useRouter()
  const [target, setTarget] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function mutate(run: () => Promise<unknown>) {
    setPending(true)
    setMessage('')
    try {
      await run()
      await router.invalidate()
      setMessage('Ruční návaznosti byly uloženy.')
      setTarget('')
      setNote('')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Uložení se nepodařilo.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-labelledby="manual-links-title"
    >
      <h2 id="manual-links-title" className="text-lg font-semibold">
        Ruční návaznosti parcel
      </h2>
      <p className="text-sm text-muted-foreground">
        ČÚZK v používaném API nedokládá nástupce při rozdělení nebo sloučení.
        Zde si můžete propojit vlastní sledování podle svého ověření. Jde o váš
        záznam, nikoli potvrzení ČÚZK; obě historie a jejich kontroly zůstanou
        samostatné. Ani HTTP 404 samo neprokazuje zánik.
      </p>
      <ul className="space-y-2">
        {data.links.map((link) => (
          <li
            key={link.id}
            className="flex flex-wrap items-start gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1 break-words">
              <p>
                {link.direction === 'outgoing'
                  ? 'Ručně navazuje:'
                  : 'Ruční návaznost ze sledování:'}{' '}
                <Link
                  to="/dashboard/watches/$id"
                  params={{ id: link.watchId }}
                  className="underline"
                >
                  {link.label}
                </Link>
              </p>
              {link.note && (
                <p className="whitespace-pre-wrap text-sm">{link.note}</p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              aria-label={`Odpojit návaznost: ${link.label}`}
              onClick={() =>
                void mutate(() => removeWatchLink({ data: { id: link.id } }))
              }
            >
              Odpojit
            </Button>
          </li>
        ))}
      </ul>
      {!data.links.length && <p>Žádné ruční návaznosti.</p>}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void mutate(() =>
            addWatchLink({
              data: { fromWatchId: watchId, toWatchId: target, note },
            }),
          )
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="manual-link-target">
            Navazující vlastní sledování
          </Label>
          <select
            id="manual-link-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            disabled={pending}
            className="w-full rounded-md border bg-background p-2"
          >
            <option value="">Vyberte parcelu</option>
            {data.candidates.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} (ISKN {w.isknId})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="manual-link-note">
            Poznámka k ověření (nepovinná)
          </Label>
          <Input
            id="manual-link-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={pending}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending || !target}>
            {pending ? 'Ukládám…' : 'Potvrdit ruční návaznost'}
          </Button>
          <Link to="/dashboard/watches/new" className="underline">
            Přidat nové sledování
          </Link>
        </div>
      </form>
      <p role="status">{message}</p>
    </section>
  )
}
