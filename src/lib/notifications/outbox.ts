import { readNotificationPolicy } from './policy'
import { decryptNotificationSecret } from './secrets'
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
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
import { sendNtfy } from './ntfy'
import { emailConfigured, sendEmail } from './email'
import { notificationErrorMessage } from './http'
import { describeChanges, eventLink } from './message'
import { sendSlackWebhook } from './slack'
import {
  DEFAULT_RULES,
  channelsForWatch,
  kindSelected,
  planDelivery,
  quietHoursEnd,
} from './schedule'
import type { DeliveryRules, NotificationChannelName } from './schedule'
import type { SettingsRow } from './settings'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const MAX_ATTEMPTS = 8
const LEASE_MS = 2 * 60_000

export type EnqueueWatch = {
  id: string
  userId: string
  label: string
  notifyKinds: string[] | null
  notifyChannels: string[] | null
}

export function rulesFromSettings(
  settings: SettingsRow | undefined,
): DeliveryRules {
  if (!settings) return DEFAULT_RULES
  return {
    timezone: settings.timezone,
    quietFromMinutes: settings.quietFromMinutes,
    quietToMinutes: settings.quietToMinutes,
    digestMode: settings.digestMode,
    digestHour: settings.digestHour,
    digestWeekday: settings.digestWeekday,
    urgentKinds: settings.urgentKinds,
  }
}

/**
 * Channels this owner can actually be reached on. Gotify falls back to the
 * instance defaults only when both the server and the token come from there.
 */
export function configuredChannels(
  settings: SettingsRow | undefined,
): NotificationChannelName[] {
  const channels: NotificationChannelName[] = []
  if (resolveGotify(settings)) channels.push('gotify')
  if (settings?.slackWebhookUrl) channels.push('slack')
  if (settings?.discordWebhookUrl) channels.push('discord')
  if (settings?.ntfyUrl) channels.push('ntfy')
  if (settings?.emailTo && emailConfigured()) channels.push('email')
  return channels
}

export function resolveGotify(settings: SettingsRow | undefined): {
  url: string
  token: string
  encrypted: boolean
  priority: number
} | null {
  const priority = settings?.gotifyPriority ?? 5
  if (settings?.gotifyUrl && settings.gotifyToken)
    return {
      url: settings.gotifyUrl,
      token: settings.gotifyToken,
      encrypted: true,
      priority,
    }
  // Server defaults need both halves: a user server must never get the instance token.
  if (
    settings?.useInstanceGotify &&
    !settings.gotifyUrl &&
    !settings.gotifyToken &&
    process.env.GOTIFY_URL &&
    process.env.GOTIFY_TOKEN
  )
    return {
      url: process.env.GOTIFY_URL,
      token: process.env.GOTIFY_TOKEN,
      encrypted: false,
      priority,
    }
  return null
}

/**
 * Queues one message per selected channel. A kind the watch filtered out is
 * still recorded as an event; only its delivery is skipped. A digest or quiet
 * hours postpone the row instead of dropping it.
 */
export async function enqueueNotifications(
  tx: Transaction,
  eventId: string,
  watch: EnqueueWatch,
  change: SnapshotChange,
  now: Date,
): Promise<number> {
  if (!kindSelected(watch.notifyKinds, change.kind)) return 0
  const settings = await tx.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, watch.userId),
  })
  const channels = channelsForWatch(
    configuredChannels(settings),
    watch.notifyChannels,
  )
  if (!channels.length) return 0

  const plan = planDelivery(rulesFromSettings(settings), change.kind, now)
  const link = eventLink(watch.id, eventId)
  const message = [describeChanges([change]), link].filter(Boolean).join('\n')
  const rows = await tx
    .insert(notificationDeliveries)
    .values(
      channels.map((channel) => ({
        eventId,
        channel,
        digest: plan.mode === 'digest',
        urgent: rulesFromSettings(settings).urgentKinds.includes(change.kind),
        title: `Hlídač ČÚZK: ${watch.label}`,
        message,
        status:
          plan.mode === 'digest' ? ('deferred' as const) : ('pending' as const),
        nextAttemptAt: plan.mode === 'now' ? now : plan.at,
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
  const policy = await readNotificationPolicy()
  const enabled = (
    ['gotify', 'slack', 'discord', 'ntfy', 'email'] as const
  ).filter((channel) => policy[`${channel}Enabled`])
  if (!enabled.length) return null
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          inArray(notificationDeliveries.channel, enabled),
          eq(notificationDeliveries.digest, false),
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

async function ownerOf(eventId: string): Promise<string> {
  const owners = await db
    .select({ userId: parcelWatches.userId })
    .from(watchEvents)
    .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
    .where(eq(watchEvents.id, eventId))
  const owner = owners.at(0)
  if (!owner) throw new Error('event_removed')
  return owner.userId
}

/** One place where a queued message meets the owner's current credentials. */
export async function sendToChannel(
  channel: NotificationDelivery['channel'],
  userId: string,
  settings: SettingsRow | undefined,
  content: { title: string; message: string },
): Promise<void> {
  if (!(await readNotificationPolicy())[`${channel}Enabled`])
    throw new Error('Kanál správce vypnul.')
  const { title, message } = content
  const secret = (
    field: 'slackWebhookUrl' | 'discordWebhookUrl' | 'ntfyToken',
  ) => decryptNotificationSecret(settings![field]!, userId, field)
  switch (channel) {
    case 'gotify': {
      const gotify = resolveGotify(settings)
      if (!gotify) throw new Error('channel_not_configured')
      await sendGotify(
        gotify.url,
        gotify.encrypted
          ? decryptNotificationSecret(gotify.token, userId, 'gotifyToken')
          : gotify.token,
        { title, message, priority: gotify.priority },
      )
      return
    }
    case 'slack':
      if (!settings?.slackWebhookUrl) throw new Error('channel_not_configured')
      await sendSlackWebhook(secret('slackWebhookUrl'), {
        text: `*${title}*\n${message}`,
      })
      return
    case 'discord':
      if (!settings?.discordWebhookUrl)
        throw new Error('channel_not_configured')
      await sendDiscordWebhook(secret('discordWebhookUrl'), {
        content: `**${title}**\n${message}`,
      })
      return
    case 'ntfy':
      if (!settings?.ntfyUrl) throw new Error('channel_not_configured')
      await sendNtfy(
        settings.ntfyUrl,
        settings.ntfyToken ? secret('ntfyToken') : null,
        { title, message },
      )
      return
    case 'email':
      if (!settings?.emailTo) throw new Error('channel_not_configured')
      await sendEmail(settings.emailTo, { title, message })
      return
  }
}

async function sendDelivery(delivery: NotificationDelivery): Promise<void> {
  const userId = await ownerOf(delivery.eventId)
  const settings = await db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  })
  await sendToChannel(delivery.channel, userId, settings, {
    title: delivery.title,
    message: delivery.message,
  })
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

  if (!delivery.urgent) {
    const owner = await ownerOf(delivery.eventId)
    const settings = await db.query.userNotificationSettings.findFirst({
      where: eq(userNotificationSettings.userId, owner),
    })
    const end = quietHoursEnd(rulesFromSettings(settings), now())
    if (end) {
      await db
        .update(notificationDeliveries)
        .set({
          status: 'pending',
          nextAttemptAt: end,
          claimToken: null,
          lockedUntil: null,
          attemptCount: sql`${notificationDeliveries.attemptCount} - 1`,
        })
        .where(ownsClaim)
      return 'pending'
    }
  }
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
      status: sql`case when ${notificationDeliveries.digest} then 'deferred' else 'pending' end`,
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

const DIGEST_MESSAGE_LIMIT = 5
const DIGEST_BODY_LIMIT = 1800

function digestEntry(row: { title: string; message: string }): string {
  const lines = row.message.split('\n')
  const detail =
    [...lines].reverse().find((line) => line.startsWith('Detail: ')) ?? ''
  const excerpt = lines
    .filter((line) => !line.startsWith('Detail: '))
    .join(' ')
    .slice(0, 120)
  return `— ${row.title.slice(0, 64)}\n${excerpt}\n${detail}`
}

type DigestGroup = { userId: string; channel: NotificationDelivery['channel'] }

/** Groups of deferred rows whose digest slot has arrived. */
async function dueDigestGroups(now: Date): Promise<DigestGroup[]> {
  const rows = await db
    .selectDistinct({
      userId: parcelWatches.userId,
      channel: notificationDeliveries.channel,
    })
    .from(notificationDeliveries)
    .innerJoin(watchEvents, eq(notificationDeliveries.eventId, watchEvents.id))
    .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
    .where(
      and(
        eq(notificationDeliveries.digest, true),
        or(
          eq(notificationDeliveries.status, 'deferred'),
          and(
            eq(notificationDeliveries.status, 'processing'),
            lte(notificationDeliveries.lockedUntil, now),
          ),
        ),
        lte(notificationDeliveries.nextAttemptAt, now),
      ),
    )
  return rows
}

/**
 * One digest per owner and channel. Rows stay queued until the combined message
 * is really sent, so a failed digest never silently consumes its events.
 */
export async function deliverDueDigests(
  options: { now?: () => Date; limit?: number } = {},
): Promise<{ sent: number; failed: number; pending: number; groups: number }> {
  const now = options.now ?? (() => new Date())
  const policy = await readNotificationPolicy()
  const result = { sent: 0, failed: 0, pending: 0, groups: 0 }
  await db
    .update(notificationDeliveries)
    .set({
      status: 'failed',
      claimToken: null,
      lockedUntil: null,
      lastError: 'Limit pokusů vyčerpán; poslední doručení nebylo potvrzeno.',
    })
    .where(
      and(
        eq(notificationDeliveries.digest, true),
        eq(notificationDeliveries.status, 'processing'),
        lte(notificationDeliveries.lockedUntil, now()),
        sql`${notificationDeliveries.attemptCount} >= ${MAX_ATTEMPTS}`,
      ),
    )
  const groups = await dueDigestGroups(now())
  for (const group of groups.slice(0, options.limit ?? 20)) {
    if (!policy[`${group.channel}Enabled`]) continue
    const at = now()
    const settings = await db.query.userNotificationSettings.findFirst({
      where: eq(userNotificationSettings.userId, group.userId),
    })
    const quietEnd = quietHoursEnd(rulesFromSettings(settings), at)
    if (quietEnd) continue
    const claimToken = crypto.randomUUID()
    // Claim the whole group in one transaction. SKIP LOCKED alone lets two
    // concurrent scans split a group into two digests, so serialize claims per
    // owner and channel; the waiting worker then sees the rows already leased.
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`hlidac:digest:${group.userId}:${group.channel}`}))`,
      )
      const ids = await tx
        .select({
          id: notificationDeliveries.id,
          title: notificationDeliveries.title,
          message: notificationDeliveries.message,
        })
        .from(notificationDeliveries)
        .innerJoin(
          watchEvents,
          eq(notificationDeliveries.eventId, watchEvents.id),
        )
        .innerJoin(parcelWatches, eq(watchEvents.watchId, parcelWatches.id))
        .where(
          and(
            eq(parcelWatches.userId, group.userId),
            eq(notificationDeliveries.channel, group.channel),
            eq(notificationDeliveries.digest, true),
            or(
              eq(notificationDeliveries.status, 'deferred'),
              and(
                eq(notificationDeliveries.status, 'processing'),
                lte(notificationDeliveries.lockedUntil, at),
              ),
            ),
            sql`${notificationDeliveries.attemptCount} < ${MAX_ATTEMPTS}`,
            lte(notificationDeliveries.nextAttemptAt, at),
          ),
        )
        .orderBy(asc(notificationDeliveries.createdAt))
        .limit(DIGEST_MESSAGE_LIMIT)
        .for('update', { skipLocked: true, of: notificationDeliveries })
      if (!ids.length) return []
      let length = 0
      let bytes = 0
      const batch = []
      for (const row of ids) {
        const entry = digestEntry(row)
        const size = entry.length + 2
        const byteSize = Buffer.byteLength(entry) + 2
        if (
          batch.length &&
          (length + size > DIGEST_BODY_LIMIT || bytes + byteSize > 3500)
        )
          break
        batch.push(row)
        length += size
        bytes += byteSize
      }
      return tx
        .update(notificationDeliveries)
        .set({
          status: 'processing',
          claimToken,
          lockedUntil: new Date(at.getTime() + LEASE_MS),
          attemptCount: sql`${notificationDeliveries.attemptCount} + 1`,
          updatedAt: at,
        })
        .where(
          inArray(
            notificationDeliveries.id,
            batch.map((row) => row.id),
          ),
        )
        .returning()
    })
    if (!claimed.length) continue
    result.groups += 1

    const message = claimed.map(digestEntry).join('\n\n')
    let lastError: string | null = null
    try {
      if (
        message.length > DIGEST_BODY_LIMIT ||
        Buffer.byteLength(message) > 3500
      )
        throw new Error('digest_message_too_long')
      await sendToChannel(group.channel, group.userId, settings, {
        title: `Hlídač ČÚZK: souhrn ${claimed.length} změn`,
        message,
      })
    } catch (error) {
      lastError =
        error instanceof Error && error.message === 'channel_not_configured'
          ? 'Kanál už není nastavený. Upravte nastavení a opakujte doručení.'
          : notificationErrorMessage(error)
    }
    const finishedAt = now()
    const attempts = Math.max(...claimed.map((row) => row.attemptCount))
    const ids = claimed.map((row) => row.id)
    const owns = and(
      inArray(notificationDeliveries.id, ids),
      eq(notificationDeliveries.status, 'processing'),
      eq(notificationDeliveries.claimToken, claimToken),
    )
    if (!lastError) {
      const updated = await db
        .update(notificationDeliveries)
        .set({
          status: 'sent',
          sentAt: finishedAt,
          lastError: null,
          claimToken: null,
          lockedUntil: null,
          updatedAt: finishedAt,
        })
        .where(owns)
        .returning({ id: notificationDeliveries.id })
      result.sent += updated.length
      continue
    }
    // Keep the events queued for the next attempt instead of dropping them.
    const retryDelay = Math.min(60, 2 ** Math.min(attempts - 1, 6)) * 60_000
    const updated = await db
      .update(notificationDeliveries)
      .set({
        status: sql`case when ${notificationDeliveries.attemptCount} >= ${MAX_ATTEMPTS} then 'failed' else 'deferred' end`,
        lastError,
        nextAttemptAt: new Date(finishedAt.getTime() + retryDelay),
        claimToken: null,
        lockedUntil: null,
        updatedAt: finishedAt,
      })
      .where(owns)
      .returning({
        id: notificationDeliveries.id,
        status: notificationDeliveries.status,
      })
    result.failed += updated.filter((row) => row.status === 'failed').length
    result.pending += updated.filter((row) => row.status === 'deferred').length
  }
  return result
}
