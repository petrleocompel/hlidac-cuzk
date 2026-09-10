import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { formatLvLabel, formatRizeniHeadline } from '#/lib/cuzk/snapshot'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'

export type WatchEventView = {
  id: string
  kind: string
  createdAt: string
  payloadJson: unknown
}

const KIND_LABELS: Record<string, string> = {
  new_rizeni: 'Plomby / řízení',
  lv_change: 'Změna LV',
  parcel_attrs: 'Atributy parcely',
  error: 'Chyba',
}

function asChange(payload: unknown): SnapshotChange | null {
  if (!payload || typeof payload !== 'object') return null
  const kind = (payload as { kind?: string }).kind
  if (
    kind === 'new_rizeni' ||
    kind === 'lv_change' ||
    kind === 'parcel_attrs'
  ) {
    return payload as SnapshotChange
  }
  return null
}

function EventBody({ event }: { event: WatchEventView }) {
  if (event.kind === 'error') {
    const msg =
      event.payloadJson &&
      typeof event.payloadJson === 'object' &&
      'message' in event.payloadJson
        ? String((event.payloadJson).message)
        : JSON.stringify(event.payloadJson)
    return <p className="text-sm text-destructive">{msg}</p>
  }

  const change = asChange(event.payloadJson)
  if (!change) {
    return (
      <pre className="max-h-40 overflow-auto text-xs text-muted-foreground">
        {JSON.stringify(event.payloadJson, null, 2)}
      </pre>
    )
  }

  if (change.kind === 'new_rizeni') {
    return (
      <div className="space-y-2 text-sm">
        {change.added.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              Nové
            </p>
            <ul className="space-y-1">
              {change.added.map((r) => (
                <li key={r.id}>
                  {formatRizeniHeadline(r)}
                  {r.isVklad ? (
                    <Badge className="ml-2" variant="default">
                      vklad
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {change.removed.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              Odstraněné
            </p>
            <ul className="space-y-1">
              {change.removed.map((r) => (
                <li key={r.id}>{formatRizeniHeadline(r)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    )
  }

  if (change.kind === 'lv_change') {
    return (
      <p className="text-sm">
        {formatLvLabel(change.previous)} → {formatLvLabel(change.next)}
        <span className="mt-1 block text-xs text-muted-foreground">
          Indikátor možné změny vlastnictví (veřejné API neuvádí jména).
        </span>
      </p>
    )
  }

  return (
    <p className="text-sm">Změněná pole: {change.fields.join(', ')}</p>
  )
}

export function WatchEventsPanel({ events }: { events: WatchEventView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie změn</CardTitle>
        <CardDescription>
          Detekované rozdíly mezi kontrolami (plomby, LV, atributy)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatím žádné události.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="rounded-xl border p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant={
                      ev.kind === 'error'
                        ? 'destructive'
                        : ev.kind === 'lv_change'
                          ? 'default'
                          : 'secondary'
                    }
                  >
                    {KIND_LABELS[ev.kind] ?? ev.kind}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(ev.createdAt).toLocaleString('cs')}
                  </span>
                </div>
                <EventBody event={ev} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
