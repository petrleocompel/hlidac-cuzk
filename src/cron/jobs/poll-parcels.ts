import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, userNotificationSettings, watchEvents } from '#/db/schema'
import {
  buildParcelSnapshot,
  diffSnapshots,
  formatLvLabel,
  formatRizeniHeadline,
  parseSnapshot
  
  
  
} from '#/lib/cuzk/snapshot'
import type {ParcelSnapshot, RizeniSnapshot, SnapshotChange} from '#/lib/cuzk/snapshot';
import { sendDiscordWebhook } from '#/lib/notifications/discord'
import { sendGotify } from '#/lib/notifications/gotify'
import { sendSlackWebhook } from '#/lib/notifications/slack'

function isDue(
  lastCheckedAt: Date | null,
  intervalMinutes: number,
  now: Date,
): boolean {
  if (!lastCheckedAt) return true
  const elapsed = now.getTime() - lastCheckedAt.getTime()
  return elapsed >= intervalMinutes * 60_000
}

export async function pollWatchById(
  watchId: string,
  now = new Date(),
): Promise<{ notified: boolean; changes: SnapshotChange[] }> {
  const watch = await db.query.parcelWatches.findFirst({
    where: eq(parcelWatches.id, watchId),
  })
  if (!watch) throw new Error('not_found')

  const next = await buildParcelSnapshot(watch.isknId, now)
  const previous = parseSnapshot(watch.lastSnapshotJson)
  const changes = diffSnapshots(previous, next)

  await db
    .update(parcelWatches)
    .set({
      lastCheckedAt: now,
      lastSnapshotJson: next,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(parcelWatches.id, watch.id))

  for (const change of changes) {
    await db.insert(watchEvents).values({
      watchId: watch.id,
      kind: change.kind,
      payloadJson: change,
    })
  }

  if (changes.length > 0) {
    await notifyUser(watch.userId, watch.label, changes, next)
    return { notified: true, changes }
  }
  return { notified: false, changes }
}

export async function pollDueWatches(now = new Date()): Promise<{
  checked: number
  notified: number
  errors: number
}> {
  const watches = await db.query.parcelWatches.findMany({
    where: eq(parcelWatches.enabled, true),
  })

  let checked = 0
  let notified = 0
  let errors = 0

  for (const watch of watches) {
    if (!isDue(watch.lastCheckedAt, watch.pollIntervalMinutes, now)) continue
    checked += 1

    try {
      const result = await pollWatchById(watch.id, now)
      if (result.notified) notified += 1
    } catch (err) {
      errors += 1
      const message = err instanceof Error ? err.message : String(err)
      await db
        .update(parcelWatches)
        .set({
          lastCheckedAt: now,
          lastError: message,
          updatedAt: now,
        })
        .where(eq(parcelWatches.id, watch.id))
      await db.insert(watchEvents).values({
        watchId: watch.id,
        kind: 'error',
        payloadJson: { message },
      })
    }
  }

  return { checked, notified, errors }
}

function describeChanges(changes: SnapshotChange[]): string {
  const lines: string[] = []
  for (const change of changes) {
    if (change.kind === 'new_rizeni') {
      if (change.added.length > 0) {
        lines.push('Nová řízení / plomby:')
        for (const r of change.added) {
          const mark = r.isVklad ? ' (vklad — možné vlastnictví)' : ''
          lines.push(`• ${formatRizeniHeadline(r)}${mark}`)
        }
      }
      if (change.removed.length > 0) {
        lines.push('Odstraněné plomby:')
        for (const r of change.removed) {
          lines.push(`• ${formatRizeniHeadline(r)}`)
        }
      }
    } else if (change.kind === 'lv_change') {
      lines.push(
        `Změna LV (indikátor vlastnictví): ${formatLvLabel(change.previous)} → ${formatLvLabel(change.next)}`,
      )
    } else {
      lines.push(`Změna atributů parcely: ${change.fields.join(', ')}`)
    }
  }
  return lines.join('\n')
}

async function notifyUser(
  userId: string,
  label: string,
  changes: SnapshotChange[],
  _snapshot: ParcelSnapshot,
) {
  const settings = await db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  })
  if (!settings) return

  const title = `Hlídač ČÚZK: ${label}`
  const message = describeChanges(changes) || 'Změna na parcele'

  if (settings.gotifyUrl && settings.gotifyToken) {
    await sendGotify(settings.gotifyUrl, settings.gotifyToken, {
      title,
      message,
      priority: settings.gotifyPriority ?? 5,
    })
  }
  if (settings.slackWebhookUrl) {
    await sendSlackWebhook(settings.slackWebhookUrl, {
      text: `*${title}*\n${message}`,
    })
  }
  if (settings.discordWebhookUrl) {
    await sendDiscordWebhook(settings.discordWebhookUrl, {
      content: `**${title}**\n${message}`,
    })
  }
}

export type { RizeniSnapshot, SnapshotChange }
