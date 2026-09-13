import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { watchEvents } from '#/db/schema'
import type { NotificationDelivery, WatchEvent } from '#/db/schema'
import { summarizeEvent } from '#/lib/notifications/message'
import { csvRows } from '#/lib/csv'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function asJson(value: unknown): Json {
  return (value ?? null) as Json
}

export type NotificationDeliveryDto = {
  id: string
  channel: NotificationDelivery['channel']
  status: NotificationDelivery['status']
  attemptCount: number
  nextAttemptAt: string
  sentAt: string | null
  lastError: string | null
}

export type WatchEventDto = {
  id: string
  watchId: string
  deliveries: NotificationDeliveryDto[]
  kind: string
  payloadJson: Json
  /** When the data behind this change was read, and its ČÚZK actuality. */
  dataFetchedAt: string | null
  dataAsOf: string | null
  createdAt: string
}

export type WatchEventPage = {
  events: WatchEventDto[]
  total: number
  limit: number
  offset: number
}

export const EVENT_KINDS = [
  'new_rizeni',
  'rizeni_progress',
  'lv_change',
  'parcel_attrs',
  'error',
] as const

type EventRow = Omit<WatchEvent, 'snapshotJson'> & {
  deliveries: NotificationDelivery[]
  dataFetchedAt?: string | null
  dataAsOf?: string | null
}

function toEventDto(row: EventRow): WatchEventDto {
  return {
    id: row.id,
    watchId: row.watchId,
    dataFetchedAt: row.dataFetchedAt ?? null,
    dataAsOf: row.dataAsOf ?? null,
    deliveries: row.deliveries.map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      sentAt: delivery.sentAt?.toISOString() ?? null,
      lastError: delivery.lastError,
    })),
    kind: row.kind,
    payloadJson: asJson(row.payloadJson),
    createdAt: row.createdAt.toISOString(),
  }
}

/** Paged history read; the index on (watchId, createdAt desc) serves the order. */
export async function readEventPage(
  watchId: string,
  options: { kinds?: string[]; limit?: number; offset?: number },
): Promise<WatchEventPage> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const where = options.kinds?.length
    ? and(
        eq(watchEvents.watchId, watchId),
        inArray(watchEvents.kind, options.kinds),
      )
    : eq(watchEvents.watchId, watchId)
  const rows = await db.query.watchEvents.findMany({
    where,
    columns: {
      id: true,
      watchId: true,
      kind: true,
      payloadJson: true,
      createdAt: true,
    },
    extras: {
      dataFetchedAt: sql<
        string | null
      >`${watchEvents.snapshotJson}->>'fetchedAt'`.as('data_fetched_at'),
      dataAsOf: sql<
        string | null
      >`${watchEvents.snapshotJson}->>'aktualnostDatK'`.as('data_as_of'),
    },
    orderBy: [desc(watchEvents.createdAt), desc(watchEvents.id)],
    limit,
    offset,
    with: { deliveries: true },
  })
  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(watchEvents)
    .where(where)
  return {
    events: rows.map(toEventDto),
    total: counted.total,
    limit,
    offset,
  }
}

export const EXPORT_LIMIT = 5000

export type WatchHistoryExport = {
  filename: string
  mime: string
  content: string
  truncated: boolean
}

/**
 * Exports the history with acquisition times. Never claims completeness beyond
 * the recorded events: the watch start and the row limit are part of the output.
 */
export async function buildEventExport(
  watch: { id: string; label: string; createdAt: Date },
  format: 'csv' | 'json',
  kinds?: string[],
): Promise<WatchHistoryExport> {
  const page = await readEventPage(watch.id, { kinds, limit: EXPORT_LIMIT })
  const rows = page.events.map((event) => ({
    createdAt: event.createdAt,
    kind: event.kind,
    summary: summarizeEvent(event),
    dataFetchedAt: event.dataFetchedAt,
    dataAsOf: event.dataAsOf,
    payload: event.payloadJson,
  }))
  const truncated = page.total > rows.length
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `hlidac-cuzk-historie-${stamp}.${format}`
  if (format === 'json')
    return {
      filename,
      mime: 'application/json',
      content: JSON.stringify(
        {
          watch: { id: watch.id, label: watch.label },
          historyFrom: watch.createdAt.toISOString(),
          exportedAt: new Date().toISOString(),
          total: page.total,
          truncated,
          events: rows,
        },
        null,
        2,
      ),
      truncated,
    }
  const header = [
    'cas_zachyceni',
    'typ',
    'popis',
    'data_nactena',
    'data_cuzk_k',
  ]
  const content = csvRows([
    header,
    ...rows.map((row) => [
      row.createdAt,
      row.kind,
      row.summary,
      row.dataFetchedAt ?? '',
      row.dataAsOf ?? '',
    ]),
  ])
  return { filename, mime: 'text/csv;charset=utf-8', content, truncated }
}
