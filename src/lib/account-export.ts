import { eq } from 'drizzle-orm'
import { db } from '#/db'
import {
  parcelWatches,
  user,
  userNotificationSettings,
  watchLinks,
} from '#/db/schema'

/** Explicit allowlist: webhook paths, topic URLs and all token material are omitted. */
export async function exportAccount(userId: string) {
  return db.transaction(
    async (tx) => {
      const owners = await tx
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
      const owner = owners.at(0)
      if (!owner) throw new Error('Účet není dostupný.')
      const watches = await tx
        .select({
          id: parcelWatches.id,
          objectType: parcelWatches.objectType,
          isknId: parcelWatches.isknId,
          label: parcelWatches.label,
          notes: parcelWatches.notes,
          tags: parcelWatches.tags,
          kuCode: parcelWatches.kuCode,
          kuName: parcelWatches.kuName,
          parcelNumber: parcelWatches.parcelNumber,
          parcelSubdivision: parcelWatches.parcelSubdivision,
          druhCislovani: parcelWatches.druhCislovani,
          enabled: parcelWatches.enabled,
          pollIntervalMinutes: parcelWatches.pollIntervalMinutes,
          notifyKinds: parcelWatches.notifyKinds,
          notifyChannels: parcelWatches.notifyChannels,
        })
        .from(parcelWatches)
        .where(eq(parcelWatches.userId, userId))
        .orderBy(parcelWatches.createdAt, parcelWatches.id)
      const settingsRows = await tx
        .select({
          gotifyPriority: userNotificationSettings.gotifyPriority,
          useInstanceGotify: userNotificationSettings.useInstanceGotify,
          emailTo: userNotificationSettings.emailTo,
          timezone: userNotificationSettings.timezone,
          quietFromMinutes: userNotificationSettings.quietFromMinutes,
          quietToMinutes: userNotificationSettings.quietToMinutes,
          digestMode: userNotificationSettings.digestMode,
          digestHour: userNotificationSettings.digestHour,
          digestWeekday: userNotificationSettings.digestWeekday,
          urgentKinds: userNotificationSettings.urgentKinds,
        })
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.userId, userId))
      const manualLinks = await tx
        .select({
          fromWatchId: watchLinks.fromWatchId,
          toWatchId: watchLinks.toWatchId,
          note: watchLinks.note,
        })
        .from(watchLinks)
        .where(eq(watchLinks.userId, userId))
        .orderBy(watchLinks.id)
      return {
        version: 1,
        manualLinks,
        exportedAt: new Date().toISOString(),
        profile: owner,
        watches,
        notifications: settingsRows.at(0) ?? null,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
