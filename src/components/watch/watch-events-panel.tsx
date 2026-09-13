import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  exportWatchEvents,
  listWatchEvents,
  retryDelivery,
} from '#/server/watches'
import { EVENT_KINDS, EXPORT_LIMIT } from '#/lib/watch-history'
import type {
  NotificationDeliveryDto,
  WatchEventDto,
} from '#/lib/watch-history'
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
  formatParcelAttrValue,
  formatRizeniHeadline,
  parcelAttrLabel,
  parseSnapshotChange,
  stavUhradyLabel,
} from '#/lib/cuzk/snapshot'

export type WatchEventView = WatchEventDto

const PAGE_SIZE = 25

const KIND_LABELS: Record<string, string> = {
  new_rizeni: 'Plomby / řízení',
  rizeni_progress: 'Průběh řízení',
  lv_change: 'Změna LV',
  parcel_attrs: 'Atributy parcely',
  error: 'Chyba',
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

  const change = parseSnapshotChange(event.payloadJson)
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

  if (change.values?.length)
    return (
      <ul className="space-y-1 text-sm">
        {change.values.map((value) => (
          <li key={value.field}>
            <span className="font-medium">{parcelAttrLabel(value.field)}:</span>{' '}
            {formatParcelAttrValue(value.field, value.previous)} →{' '}
            {formatParcelAttrValue(value.field, value.next)}
          </li>
        ))}
      </ul>
    )

  // Events recorded before values were stored only know the field names.
  return (
    <p className="text-sm">
      Změněná pole: {change.fields.map(parcelAttrLabel).join(', ')}
      <span className="mt-1 block text-xs text-muted-foreground">
        Starší událost bez uložených hodnot.
      </span>
    </p>
  )
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

function downloadFile(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function WatchEventsPanel({
  watchId,
  events,
  total,
  historyFrom,
}: {
  watchId: string
  events: WatchEventView[]
  total: number
  historyFrom: string
}) {
  const router = useRouter()
  const [rows, setRows] = useState(events.slice(0, PAGE_SIZE))
  const [count, setCount] = useState(total)
  const [offset, setOffset] = useState(0)
  const [kinds, setKinds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  async function load(nextOffset: number, nextKinds: string[]) {
    setBusy(true)
    setFeedback(null)
    try {
      const page = await listWatchEvents({
        data: {
          id: watchId,
          kinds: nextKinds.length ? nextKinds : undefined,
          limit: PAGE_SIZE,
          offset: nextOffset,
        },
      })
      setRows(page.events)
      setCount(page.total)
      setOffset(page.offset)
      setKinds(nextKinds)
    } catch {
      setFeedback('Historii se nepodařilo načíst. Zkuste to znovu.')
    } finally {
      setBusy(false)
    }
  }

  async function onExport(format: 'csv' | 'json') {
    setBusy(true)
    setFeedback(null)
    try {
      const file = await exportWatchEvents({
        data: { id: watchId, format, kinds: kinds.length ? kinds : undefined },
      })
      downloadFile(file.filename, file.mime, file.content)
      setFeedback(
        file.truncated
          ? `Export obsahuje nejnovějších ${EXPORT_LIMIT.toLocaleString('cs')} událostí; starší nejsou zahrnuté.`
          : 'Export byl připraven ke stažení.',
      )
    } catch {
      setFeedback('Export se nepodařilo připravit.')
    } finally {
      setBusy(false)
    }
  }

  const from = count === 0 ? 0 : offset + 1
  const to = Math.min(offset + rows.length, count)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie změn</CardTitle>
        <CardDescription>
          Zachycené rozdíly mezi kontrolami (plomby, řízení, LV, atributy).
          Historie začíná {new Date(historyFrom).toLocaleString('cs')}, kdy bylo
          sledování založeno — starší změny k dispozici nejsou.
        </CardDescription>
        <div
          className="flex flex-wrap gap-1.5 pt-2"
          role="group"
          aria-label="Filtr typů událostí"
        >
          {EVENT_KINDS.map((kind) => {
            const active = kinds.includes(kind)
            return (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                aria-pressed={active}
                disabled={busy}
                onClick={() =>
                  void load(
                    0,
                    active
                      ? kinds.filter((value) => value !== kind)
                      : [...kinds, kind],
                  )
                }
              >
                {KIND_LABELS[kind] ?? kind}
              </Button>
            )
          })}
          {kinds.length ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void load(0, [])}
            >
              Zrušit filtr
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              await router.invalidate()
              await load(offset, kinds)
              setFeedback('Stav doručení byl obnoven.')
            }}
          >
            {busy ? 'Obnovuji…' : 'Obnovit stav doručení'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onExport('csv')}
          >
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onExport('json')}
          >
            Export JSON
          </Button>
        </div>
        <p role="status" className="text-xs">
          {feedback}
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {kinds.length
              ? 'Pro zvolený filtr nejsou žádné události.'
              : 'Zatím žádné události.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((ev) => (
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
                {ev.dataFetchedAt || ev.dataAsOf ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ev.dataFetchedAt
                      ? `Data načtena ${new Date(ev.dataFetchedAt).toLocaleString('cs')}`
                      : ''}
                    {ev.dataAsOf
                      ? ` · ČÚZK k ${new Date(ev.dataAsOf).toLocaleString('cs')}`
                      : ''}
                  </p>
                ) : null}
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {count === 0 ? 'Bez událostí' : `${from}–${to} z ${count}`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || offset === 0}
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE), kinds)}
            >
              Novější
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || to >= count}
              onClick={() => void load(offset + PAGE_SIZE, kinds)}
            >
              Starší
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
