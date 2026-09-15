import { and, eq, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { ensureDbReady } from '#/db/migrate'
import { db } from '#/db'
import { notificationDeliveries, parcelWatches, watchEvents } from '#/db/schema'
import {
  notificationSettingsDto,
  readNotificationSettings,
} from '#/lib/notifications/settings'
import { NOTIFICATION_CHANNELS } from '#/lib/watch-event'
import type { NotificationChannel } from '#/lib/watch-event'

export type NotificationChannelStatus = {
  channel: NotificationChannel
  configured: boolean
  lastDeliveredAt: string | null
}

export const getNotificationChannelsStatus = createServerFn({
  method: 'GET',
}).handler(async (): Promise<NotificationChannelStatus[]> => {
  const session = await requireSession()
  await ensureDbReady()
  const settings = notificationSettingsDto(
    await readNotificationSettings(session.user.id),
  )

  const configured: Record<NotificationChannel, boolean> = {
    gotify:
      settings.useInstanceGotify ||
      Boolean(settings.gotifyUrl && settings.gotifyTokenConfigured),
    slack: settings.slackWebhookConfigured,
    discord: settings.discordWebhookConfigured,
    ntfy: Boolean(settings.ntfyUrl && settings.ntfyTokenConfigured),
    email: settings.emailAvailable && Boolean(settings.emailTo),
  }

  const rows = await db
    .select({
      channel: notificationDeliveries.channel,
      lastSentAt: sql<string | null>`max(${notificationDeliveries.sentAt})::text`,
    })
    .from(notificationDeliveries)
    .innerJoin(
      watchEvents,
      eq(notificationDeliveries.eventId, watchEvents.id),
    )
    .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
    .where(
      and(
        eq(parcelWatches.userId, session.user.id),
        eq(notificationDeliveries.status, 'sent'),
      ),
    )
    .groupBy(notificationDeliveries.channel)

  const lastDelivered = new Map<NotificationChannel, string>()
  for (const row of rows) {
    if (row.lastSentAt) {
      lastDelivered.set(row.channel, new Date(row.lastSentAt).toISOString())
    }
  }

  return NOTIFICATION_CHANNELS.map((channel) => ({
    channel,
    configured: configured[channel],
    lastDeliveredAt: lastDelivered.get(channel) ?? null,
  }))
})
