import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
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
import { followRizeni, unfollowRizeni } from '#/server/rizeni'
import type { TrackedRizeniDto } from '#/server/rizeni'
import { TYPY_RIZENI } from '#/lib/cuzk/rizeni-codes'
import type { TypRizeni } from '#/lib/cuzk/rizeni-codes'
import { rizeniTypeLabel, stavUhradyLabel } from '#/lib/cuzk/snapshot'

const END_REASONS: Record<string, string> = {
  window: 'Okno dalšího dotazování uplynulo.',
  unavailable: 'ČÚZK už řízení nevrací; další dotazy nemají co vrátit.',
  user: 'Sledování jste ukončili.',
  capacity: 'Byl vyčerpán limit souběžně sledovaných řízení.',
}

function headline(row: TrackedRizeniDto): string {
  const typ = row.typRizeni ?? row.detail?.typRizeni ?? null
  const cislo = row.poradoveCislo ?? row.detail?.poradoveCislo ?? '?'
  const rok = row.rok ?? row.detail?.rok ?? '?'
  return `${rizeniTypeLabel(typ)} ${typ ?? ''} ${cislo}/${rok}`.replace(
    /\s+/g,
    ' ',
  )
}

function datetime(value: string | null): string {
  return value ? new Date(value).toLocaleString('cs') : '—'
}

function FollowState({
  row,
  followDays,
}: {
  row: TrackedRizeniDto
  followDays: number
}) {
  if (row.isPlomba)
    return (
      <Badge variant="secondary">
        plomba na parcele · sledujeme s parcelou
      </Badge>
    )
  if (row.followEndedAt)
    return (
      <Badge variant="outline">
        sledování ukončeno {datetime(row.followEndedAt)}
      </Badge>
    )
  if (row.source === 'manual')
    return <Badge>přidané řízení · sledujeme do ručního ukončení</Badge>
  return (
    <Badge>
      odpojeno od parcely {datetime(row.detachedAt)} · dotazujeme do{' '}
      {row.followUntil
        ? datetime(row.followUntil)
        : `${followDays} dnů po odpojení`}
    </Badge>
  )
}

function RizeniRow({
  row,
  followDays,
  onChanged,
}: {
  row: TrackedRizeniDto
  followDays: number
  onChanged: (message: string) => void
}) {
  const [pending, setPending] = useState(false)
  const detail = row.detail
  const stale =
    detail?.detailAvailable === false ||
    detail?.knownFields?.some(
      (field) => !detail.availableFields?.includes(field),
    )
  return (
    <li className="space-y-2 rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{headline(row)}</p>
          <p className="text-xs text-muted-foreground">
            ISKN {row.rizeniId}
            {row.kodPracoviste != null
              ? ` · pracoviště ${row.kodPracoviste}`
              : ''}
            {' · detail načten '}
            {datetime(row.detailFetchedAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {detail?.isVklad ? <Badge>Vklad</Badge> : null}
          <FollowState row={row} followDays={followDays} />
        </div>
      </div>

      <p className="text-sm">
        Stav: {detail?.stav ?? 'neuvádí se u tohoto typu řízení'}
      </p>
      <p className="text-sm text-muted-foreground">
        Úhrada: {stavUhradyLabel(detail?.stavUhrady)}
      </p>
      {stale ? (
        <p className="text-xs text-muted-foreground">
          Některé údaje detailu teď nejsou dostupné. Zobrazené hodnoty jsou
          poslední známé, nikoli nově potvrzené.
        </p>
      ) : null}
      {row.lastError ? (
        <p className="text-xs text-destructive">{row.lastError}</p>
      ) : null}
      {row.followEndedAt && row.followEndedReason ? (
        <p className="text-xs text-muted-foreground">
          {END_REASONS[row.followEndedReason]} Výsledek řízení z toho nevyplývá.
        </p>
      ) : null}
      {detail?.provedeneOperace.length ? (
        <ol className="space-y-1 border-l-2 border-border pl-3 text-sm">
          {detail.provedeneOperace.map((op, idx) => (
            <li key={`${row.rizeniId}-${idx}`}>
              <span className="font-medium">{op.nazev}</span>
              {op.datumProvedeni ? (
                <span className="text-muted-foreground">
                  {' · '}
                  {new Date(op.datumProvedeni).toLocaleString('cs')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {detail?.poznamky.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {detail.poznamky.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {!row.isPlomba && !row.followEndedAt ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              try {
                await unfollowRizeni({ data: { id: row.id } })
                onChanged('Sledování řízení bylo ukončeno. Historie zůstává.')
              } catch (error) {
                onChanged(
                  error instanceof Error
                    ? error.message
                    : 'Sledování se nepodařilo ukončit.',
                )
              } finally {
                setPending(false)
              }
            }}
          >
            {pending ? 'Ukončuji…' : 'Přestat dotazovat'}
          </Button>
        ) : null}
      </div>
    </li>
  )
}

function LinkedRizeni({
  watchId,
  rows,
  onChanged,
}: {
  watchId: string
  rows: TrackedRizeniDto[]
  onChanged: (message: string) => void
}) {
  const [pending, setPending] = useState<string | null>(null)
  const tracked = new Set(rows.map((row) => row.rizeniId))
  const linked = rows
    .flatMap((row) => row.detail?.navazanaRizeni ?? [])
    .filter((item) => item.id && !tracked.has(item.id))
  const unique = [...new Map(linked.map((item) => [item.id, item])).values()]
  if (!unique.length) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Navázaná řízení
      </p>
      <ul className="space-y-2 text-sm">
        {unique.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2">
            <span>
              {rizeniTypeLabel(item.typRizeni)} {item.poradoveCislo ?? '?'}/
              {item.rok ?? '?'}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending === item.id}
              onClick={async () => {
                setPending(item.id)
                try {
                  const result = await followRizeni({
                    data: { watchId, rizeniId: item.id },
                  })
                  onChanged(
                    result.alreadyTracked
                      ? 'Toto řízení už sledujete.'
                      : 'Řízení bylo přidáno ke sledování.',
                  )
                } catch (error) {
                  onChanged(
                    error instanceof Error
                      ? error.message
                      : 'Řízení se nepodařilo přidat.',
                  )
                } finally {
                  setPending(null)
                }
              }}
            >
              {pending === item.id ? 'Přidávám…' : 'Sledovat i toto řízení'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WatchRizeniPanel({
  watchId,
  rizeni,
  followDays,
}: {
  watchId: string
  rizeni: TrackedRizeniDto[]
  followDays: number
}) {
  const router = useRouter()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function report(message: string) {
    setFeedback(message)
    await router.invalidate()
  }

  async function onFollow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setPending(true)
    setFeedback(null)
    try {
      const result = await followRizeni({
        data: {
          watchId,
          typRizeni: (values.get('typRizeni') as TypRizeni | null) ?? 'V',
          cislo: Number(values.get('cislo')),
          rok: Number(values.get('rok')),
          kodPracoviste: Number(values.get('kodPracoviste')),
        },
      })
      form.reset()
      await report(
        result.alreadyTracked
          ? 'Toto řízení už sledujete.'
          : 'Řízení bylo ověřeno v ČÚZK a přidáno ke sledování.',
      )
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Řízení se nepodařilo přidat.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sledovaná řízení</CardTitle>
        <CardDescription>
          Řízení se sleduje jako samostatný objekt. Po odebrání plomby se jeho
          detail dotazuje ještě {followDays} dnů, takže historie nezmizí;
          samotné odebrání plomby neznamená schválený vklad. Stav a operace ČÚZK
          plní jen u některých typů řízení.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rizeni.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatím žádné řízení. Plomby se doplní při první kontrole; známé
            řízení můžete přidat níže.
          </p>
        ) : (
          <ul className="space-y-3">
            {rizeni.map((row) => (
              <RizeniRow
                key={row.id}
                row={row}
                followDays={followDays}
                onChanged={(message) => void report(message)}
              />
            ))}
          </ul>
        )}

        <LinkedRizeni
          watchId={watchId}
          rows={rizeni}
          onChanged={(message) => void report(message)}
        />

        <form className="space-y-3 border-t pt-4" onSubmit={onFollow}>
          <p className="text-sm font-medium">Přidat známé řízení</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="typRizeni">Typ</Label>
              <select
                id="typRizeni"
                name="typRizeni"
                defaultValue="V"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TYPY_RIZENI.map((typ) => (
                  <option key={typ} value={typ}>
                    {typ} — {rizeniTypeLabel(typ)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cislo">Číslo</Label>
              <Input id="cislo" name="cislo" type="number" min={1} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rok">Rok</Label>
              <Input
                id="rok"
                name="rok"
                type="number"
                min={2003}
                max={2099}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kodPracoviste">Pracoviště</Label>
              <Input
                id="kodPracoviste"
                name="kodPracoviste"
                type="number"
                min={1}
                max={999}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Vyhledání ČÚZK vyžaduje všechny čtyři údaje. Každé sledované řízení
            navíc spotřebuje jedno volání API při každé kontrole.
          </p>
          <Button type="submit" disabled={pending}>
            {pending ? 'Ověřuji v ČÚZK…' : 'Ověřit a sledovat'}
          </Button>
        </form>
        <p role="status" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      </CardContent>
    </Card>
  )
}
