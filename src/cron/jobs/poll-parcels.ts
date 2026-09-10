import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches, userNotificationSettings, watchEvents } from '#/db/schema'
import {
  formatRizeniLabel,
  getParcelById,
  rizeniFingerprint,
  snapshotRizeniPlomby,
} from '#/lib/cuzk/client'
import type { RizeniDef } from '#/lib/cuzk/client'
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
      const response = await getParcelById(watch.isknId)
      const parcel = response.data
      if (!parcel) throw new Error('Prázdná odpověď ČÚZK')

      const nextSnapshot = snapshotRizeniPlomby(parcel)
      const prevSnapshot = (watch.lastSnapshotJson as RizeniDef[] | null) ?? null
      const prevFp = prevSnapshot ? rizeniFingerprint(prevSnapshot) : null
      const nextFp = rizeniFingerprint(nextSnapshot)

      const firstPoll = prevSnapshot === null
      const changed = !firstPoll && prevFp !== nextFp

      await db
        .update(parcelWatches)
        .set({
          lastCheckedAt: now,
          lastSnapshotJson: nextSnapshot,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(parcelWatches.id, watch.id))

      if (changed) {
        const added = nextSnapshot.filter(
          (r) =>
            !prevSnapshot.some(
              (p) => String(p.id ?? '') === String(r.id ?? ''),
            ),
        )
        await db.insert(watchEvents).values({
          watchId: watch.id,
          kind: 'new_rizeni',
          payloadJson: { previous: prevSnapshot, next: nextSnapshot, added },
        })
        await notifyUser(watch.userId, watch.label, added, nextSnapshot)
        notified += 1
      }
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

async function notifyUser(
  userId: string,
  label: string,
  added: RizeniDef[],
  all: RizeniDef[],
) {
  const settings = await db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  })
  if (!settings) return

  const detail =
    added.length > 0
      ? added.map((r) => `• ${formatRizeniLabel(r)}`).join('\n')
      : `Změna plomb (${all.length} řízení)`

  const title = `Hlídač ČÚZK: ${label}`
  const message = `Nové / změněné řízení na parcele:\n${detail}`

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
}
