/** Browser-safe watch history kinds and DTOs (no DB / Node imports). */

export const EVENT_KINDS = [
  'new_rizeni',
  'rizeni_progress',
  'lv_change',
  'parcel_attrs',
  'error',
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

export const EXPORT_LIMIT = 5000

export const NOTIFICATION_CHANNELS = [
  'gotify',
  'slack',
  'discord',
  'ntfy',
  'email',
] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const DELIVERY_STATUSES = [
  'pending',
  'processing',
  'sent',
  'failed',
  'deferred',
] as const

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type NotificationDeliveryDto = {
  id: string
  channel: NotificationChannel
  status: DeliveryStatus
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

export type WatchHistoryExport = {
  filename: string
  mime: string
  content: string
  truncated: boolean
}
