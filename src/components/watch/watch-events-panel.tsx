import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { retryDelivery } from '#/server/watches'
import type { NotificationDeliveryDto } from '#/server/watches'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  formatLvLabel,
  formatRizeniHeadline,
  stavUhradyLabel,
} from '#/lib/cuzk/snapshot'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'

export type WatchEventView = {
  id: string
  kind: string
  createdAt: string
  payloadJson: unknown
  deliveries: NotificationDeliveryDto[]
}

const KIND_LABELS: Record<string, string> = {
  new_rizeni: 'Plomby / řízení',
  rizeni_progress: 'Průběh řízení',
  lv_change: 'Změna LV',
  parcel_attrs: 'Atributy parcely',
  error: 'Chyba',
}

function asChange(payload: unknown): SnapshotChange | null {
  if (!payload || typeof payload !== 'object') return null
  const kind = (payload as { kind?: string }).kind
  if (
    kind === 'new_rizeni' ||
    kind === 'rizeni_progress' ||
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
        ? String(event.payloadJson.message)
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
              Odstraněné plomby — nepotvrzuje schválení vkladu
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

  if (change.kind === 'rizeni_progress') {
    return (
      <div className="space-y-1 text-sm">
        <p className="font-medium">{formatRizeniHeadline(change.next)}</p>
        {change.followed ? (
          <p className="text-xs text-muted-foreground">
            Řízení už není plombou na parcele; sledujeme jeho vlastní detail.
          </p>
        ) : null}
        {change.fields.includes('stav') ? (
          <p>
            Stav: {change.previous.stav ?? 'neznámý'} →{' '}
            {change.next.stav ?? 'neznámý'}
          </p>
        ) : null}
        {change.fields.includes('stavUhrady') ? (
          <p>
            Úhrada: {stavUhradyLabel(change.previous.stavUhrady)} →{' '}
            {stavUhradyLabel(change.next.stavUhrady)}
          </p>
        ) : null}
        {change.addedOperations.length ? (
          <ul className="list-disc pl-5">
            {change.addedOperations.map((op, i) => (
              <li key={i}>
                Nová operace: {op.nazev}
                {op.datumProvedeni
                  ? ` (${new Date(op.datumProvedeni).toLocaleString('cs')})`
                  : ''}
              </li>
            ))}
          </ul>
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

  return <p className="text-sm">Změněná pole: {change.fields.join(', ')}</p>
}

const CHANNEL_LABELS = { gotify: 'Gotify', slack: 'Slack', discord: 'Discord' }
const DELIVERY_LABELS = {
  pending: 'Čeká na doručení',
  processing: 'Odesílá se',
  sent: 'Odesláno',
  failed: 'Doručení selhalo',
}

function DeliveryStatus({ delivery }: { delivery: NotificationDeliveryDto }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const channel = CHANNEL_LABELS[delivery.channel]
  const canRetry =
    delivery.status === 'failed' ||
    (delivery.status === 'pending' && delivery.lastError)
  return (
    <li className="space-y-1 text-xs">
      <p>
        {channel}: {DELIVERY_LABELS[delivery.status]} · pokusy:{' '}
        {delivery.attemptCount}
      </p>
      {delivery.sentAt ? (
        <p>Odesláno {new Date(delivery.sentAt).toLocaleString('cs')}</p>
      ) : null}
      {delivery.status === 'pending' ? (
        <p>
          Další pokus nejdříve{' '}
          {new Date(delivery.nextAttemptAt).toLocaleString('cs')}
        </p>
      ) : null}
      {delivery.lastError ? (
        <p className="text-destructive">{delivery.lastError}</p>
      ) : null}
      {canRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={async () => {
            setPending(true)
            setFeedback(null)
            try {
              await retryDelivery({ data: { id: delivery.id } })
              setFeedback('Zařazeno k dalšímu pokusu o doručení.')
              await router.invalidate()
            } catch {
              setFeedback(
                'Opakování se nepodařilo. Obnovte stav a zkuste to znovu.',
              )
            } finally {
              setPending(false)
            }
          }}
        >
          {pending ? 'Zařazuji…' : `Opakovat doručení přes ${channel}`}
        </Button>
      ) : null}
      <p role="status">{feedback}</p>
    </li>
  )
}

export function WatchEventsPanel({ events }: { events: WatchEventView[] }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie změn</CardTitle>
        <CardDescription>
          Detekované rozdíly mezi kontrolami (plomby, LV, atributy)
        </CardDescription>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            try {
              await router.invalidate()
              setFeedback('Stav doručení byl obnoven.')
            } catch {
              setFeedback('Stav se nepodařilo obnovit.')
            } finally {
              setRefreshing(false)
            }
          }}
        >
          {refreshing ? 'Obnovuji…' : 'Obnovit stav doručení'}
        </Button>
        <p role="status" className="text-xs">
          {feedback}
        </p>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádné události.</p>
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
                {ev.kind !== 'error' ? (
                  <div className="mt-3 border-t pt-3">
                    {ev.deliveries.length ? (
                      <ul
                        className="space-y-3"
                        aria-label="Doručení upozornění"
                      >
                        {ev.deliveries.map((delivery) => (
                          <DeliveryStatus
                            key={delivery.id}
                            delivery={delivery}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Změna zachycena. Doručení není evidováno (starší událost
                        nebo žádný nastavený kanál).
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
