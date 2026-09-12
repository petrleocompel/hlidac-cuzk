import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { user, userNotificationSettings } from '#/db/schema'
import {
  decryptNotificationSecret,
  encryptNotificationSecret,
  isEncryptedNotificationSecret,
  notificationEncryptionConfigured,
  NotificationConfigurationError,
} from './secrets'

/** Run with web/worker stopped; transaction rolls back on any invalid old key/value. */
export async function migrateNotificationSecrets(): Promise<number> {
  if (!notificationEncryptionConfigured())
    throw new NotificationConfigurationError(
      'Nejprve nastavte NOTIFICATION_ENCRYPTION_KEY.',
    )
  return db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).orderBy(user.id).for('update')
    const rows = await tx.select().from(userNotificationSettings).for('update')
    let count = 0
    for (const row of rows) {
      const changed: Partial<typeof userNotificationSettings.$inferInsert> = {}
      for (const field of [
        'gotifyToken',
        'slackWebhookUrl',
        'discordWebhookUrl',
      ] as const) {
        const value = row[field]
        if (!value) continue
        const plaintext = isEncryptedNotificationSecret(value)
          ? decryptNotificationSecret(value, row.userId, field)
          : value
        changed[field] = encryptNotificationSecret(plaintext, row.userId, field)
        count++
      }
      if (Object.keys(changed).length)
        await tx
          .update(userNotificationSettings)
          .set({ ...changed, updatedAt: new Date() })
          .where(eq(userNotificationSettings.userId, row.userId))
    }
    return count
  })
}
