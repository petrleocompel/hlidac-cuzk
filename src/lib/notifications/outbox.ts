import { and, asc, eq, inArray, lte, or } from 'drizzle-orm'
import { db } from '#/db'
import {
  notificationDeliveries,
  parcelWatches,
  userNotificationSettings,
  watchEvents,
} from '#/db/schema'
import type { NotificationDelivery } from '#/db/schema'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'
import { sendDiscordWebhook } from './discord'
import { sendGotify } from './gotify'
import { notificationErrorMessage } from './http'
import { describeChanges } from './message'
import { sendSlackWebhook } from './slack'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const MAX_ATTEMPTS = 8
const LEASE_MS = 2 * 60_000

export async function enqueueNotifications(
  tx: Transaction,
  eventId: string,
  userId: string,
  label: string,
  change: SnapshotChange,
  now: Date,
): Promise<number> {
  const settings = await tx.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  })
  const channels: NotificationDelivery['channel'][] = []
  if (settings?.gotifyUrl && settings.gotifyToken) channels.push('gotify')
  if (settings?.slackWebhookUrl) channels.push('slack')
  if (settings?.discordWebhookUrl) channels.push('discord')
  if (!channels.length) return 0

  const rows = await tx
    .insert(notificationDeliveries)
    .values(
      channels.map((channel) => ({
        eventId,
        channel,
        title: `Hlídač ČÚZK: ${label}`,
        message: describeChanges([change]),
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [notificationDeliveries.eventId, notificationDeliveries.channel],
    })
    .returning({ id: notificationDeliveries.id })
  return rows.length
}

/** Short transaction: claim one row, then release the DB lock before network I/O. */
export async function claimDelivery(
  now = new Date(),
): Promise<NotificationDelivery | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notificationDeliveries)
      .where(
        or(
          and(
            eq(notificationDeliveries.status, 'pending'),
            lte(notificationDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(notificationDeliveries.status, 'processing'),
            lte(notificationDeliveries.lockedUntil, now),
          ),
        ),
      )
      .orderBy(
        asc(notificationDeliveries.nextAttemptAt),
        asc(notificationDeliveries.id),
      )
      .limit(1)
      .for('update', { skipLocked: true })
    const row = rows.at(0)
    if (!row) return null
    // A crash during the last attempt must not grant another automatic send.
    const exhausted = row.attemptCount >= MAX_ATTEMPTS
    const [claimed] = await tx
      .update(notificationDeliveries)
      .set({
        status: exhausted ? 'failed' : 'processing',
        claimToken: exhausted ? null : crypto.randomUUID(),
        lockedUntil: exhausted ? null : new Date(now.getTime() + LEASE_MS),
        attemptCount: exhausted ? row.attemptCount : row.attemptCount + 1,
        lastError: exhausted
          ? 'Poslední pokus nebyl potvrzen. Limit pokusů byl vyčerpán; zkontrolujte kanál před ručním opakováním.'
          : row.lastError,
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, row.id))
      .returning()
    return claimed
  })
}

async function sendDelivery(delivery: NotificationDelivery): Promise<void> {
  const owners = await db
    .select({ userId: parcelWatches.userId })
    .from(watchEvents)
    .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
    .where(eq(watchEvents.id, delivery.eventId))
  const owner = owners.at(0)
  if (!owner) throw new Error('event_removed')
  const settings = await db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, owner.userId),
  })
  const { title, message } = delivery
  switch (delivery.channel) {
    case 'gotify':
      if (!settings?.gotifyUrl || !settings.gotifyToken)
        throw new Error('channel_not_configured')
      await sendGotify(settings.gotifyUrl, settings.gotifyToken, {
        title,
        message,
        priority: settings.gotifyPriority ?? 5,
      })
      return
    case 'slack':
      if (!settings?.slackWebhookUrl) throw new Error('channel_not_configured')
      await sendSlackWebhook(settings.slackWebhookUrl, {
        text: `*${title}*\n${message}`,
      })
      return
    case 'discord':
      if (!settings?.discordWebhookUrl)
        throw new Error('channel_not_configured')
      await sendDiscordWebhook(settings.discordWebhookUrl, {
        content: `**${title}**\n${message}`,
      })
      return
  }
}

/** A stale worker must never acknowledge a newer worker's claim. */
export async function deliverClaimedNotification(
  delivery: NotificationDelivery,
  now: () => Date = () => new Date(),
): Promise<'sent' | 'pending' | 'failed' | 'stale'> {
  if (!delivery.claimToken) throw new Error('delivery_not_claimed')
  const ownsClaim = and(
    eq(notificationDeliveries.id, delivery.id),
    eq(notificationDeliveries.status, 'processing'),
    eq(notificationDeliveries.claimToken, delivery.claimToken),
  )
  // Do not start another request after our lease has already expired.
  const current = await db.query.notificationDeliveries.findFirst({
    where: ownsClaim,
  })
  if (!current?.lockedUntil || current.lockedUntil <= now()) return 'stale'

  let lastError: string | null = null
  try {
    await sendDelivery(delivery)
  } catch (error) {
    lastError =
      error instanceof Error && error.message === 'channel_not_configured'
        ? 'Kanál už není nastavený. Upravte nastavení a opakujte doručení.'
        : notificationErrorMessage(error)
  }
  const finishedAt = now()
  const status = lastError
    ? delivery.attemptCount >= MAX_ATTEMPTS
      ? 'failed'
      : 'pending'
    : 'sent'
  const retryDelay =
    Math.min(60, 2 ** Math.min(delivery.attemptCount - 1, 6)) * 60_000
  const updated = await db
    .update(notificationDeliveries)
    .set({
      status,
      lastError,
      sentAt: status === 'sent' ? finishedAt : null,
      nextAttemptAt: new Date(finishedAt.getTime() + retryDelay),
      claimToken: null,
      lockedUntil: null,
      updatedAt: finishedAt,
    })
    .where(ownsClaim)
    .returning({ id: notificationDeliveries.id })
  return updated.length ? status : 'stale'
}

export async function deliverDueNotifications(
  options: {
    limit?: number
    now?: () => Date
  } = {},
): Promise<{ sent: number; pending: number; failed: number; stale: number }> {
  const now = options.now ?? (() => new Date())
  const result = { sent: 0, pending: 0, failed: 0, stale: 0 }
  for (let i = 0; i < (options.limit ?? 50); i++) {
    const delivery = await claimDelivery(now())
    if (!delivery) break
    if (delivery.status === 'failed') {
      result.failed += 1
      continue
    }
    const status = await deliverClaimedNotification(delivery, now)
    result[status] += 1
  }
  return result
}

/** Ownership is part of the UPDATE, including races with deletion/claiming. */
export async function retryNotificationDelivery(
  id: string,
  userId: string,
  now = new Date(),
): Promise<void> {
  const ownedEvents = db
    .select({ id: watchEvents.id })
    .from(watchEvents)
    .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
    .where(eq(parcelWatches.userId, userId))
  const updated = await db
    .update(notificationDeliveries)
    .set({
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: now,
      lastError: null,
      claimToken: null,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationDeliveries.id, id),
        inArray(notificationDeliveries.eventId, ownedEvents),
        inArray(notificationDeliveries.status, ['pending', 'failed']),
      ),
    )
    .returning({ id: notificationDeliveries.id })
  if (!updated.length)
    throw new Error('Doručení nelze opakovat nebo nebylo nalezeno.')
}
