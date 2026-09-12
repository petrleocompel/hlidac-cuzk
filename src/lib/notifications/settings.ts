import { readNotificationPolicy } from './policy'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db'
import { user, userNotificationSettings } from '#/db/schema'
import {
  displayGotifyUrl,
  normalizeGotifyUrl,
  validateNotificationDestination,
} from './destinations'
import {
  encryptNotificationSecret,
  notificationEncryptionConfigured,
  NotificationConfigurationError,
} from './secrets'
import type { NotificationSecretField } from './secrets'

const secretPatch = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('keep') }),
    z.object({ action: z.literal('remove') }),
    z.object({
      action: z.literal('replace'),
      value: z.string().trim().min(1).max(4096),
    }),
  ])
  .default({ action: 'keep' })
export const SettingsInput = z.object({
  gotifyUrl: z.string().max(2048).default(''),
  gotifyPriority: z.coerce.number().int().min(0).max(10).default(5),
  gotifyToken: secretPatch,
  slackWebhookUrl: secretPatch,
  discordWebhookUrl: secretPatch,
})
export type SettingsPatch = z.infer<typeof SettingsInput>
export type SettingsRow = typeof userNotificationSettings.$inferSelect

export function notificationSettingsDto(row: SettingsRow | undefined) {
  return {
    gotifyUrl: displayGotifyUrl(row?.gotifyUrl),
    gotifyPriority: row?.gotifyPriority ?? 5,
    gotifyTokenConfigured: Boolean(row?.gotifyToken),
    slackWebhookConfigured: Boolean(row?.slackWebhookUrl),
    discordWebhookConfigured: Boolean(row?.discordWebhookUrl),
    encryptionConfigured: notificationEncryptionConfigured(),
  }
}

export async function readNotificationSettings(userId: string) {
  return db.query.userNotificationSettings.findFirst({
    where: eq(userNotificationSettings.userId, userId),
  })
}

export async function updateNotificationSettings(
  userId: string,
  data: SettingsPatch,
) {
  const policy = await readNotificationPolicy()
  return db.transaction(async (tx) => {
    // Serialize first insert as well as subsequent updates for this owner.
    const owners = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
    if (!owners.at(0)) throw new Error('Uživatel neexistuje.')
    const rows = await tx
      .select()
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
    const previous = rows.at(0)
    const gotifyUrl = data.gotifyUrl.trim()
      ? normalizeGotifyUrl(data.gotifyUrl.trim())
      : null
    if (
      gotifyUrl &&
      (gotifyUrl !== previous?.gotifyUrl ||
        data.gotifyToken.action === 'replace')
    )
      validateNotificationDestination(gotifyUrl, 'gotify', policy)
    if (
      previous?.gotifyToken &&
      previous.gotifyUrl !== gotifyUrl &&
      data.gotifyToken.action === 'keep'
    ) {
      throw new NotificationConfigurationError(
        'Při změně serveru Gotify nahraďte nebo odeberte také token.',
      )
    }
    function apply(field: NotificationSecretField) {
      const patch = data[field]
      if (patch.action === 'keep') return previous?.[field] ?? null
      if (patch.action === 'remove') return null
      if (field === 'gotifyToken') {
        if (!gotifyUrl || /[\r\n]/.test(patch.value))
          throw new NotificationConfigurationError(
            'Token vyžaduje povolený Gotify server a nesmí obsahovat konec řádku.',
          )
      } else
        validateNotificationDestination(
          patch.value,
          field === 'slackWebhookUrl' ? 'slack' : 'discord',
          policy,
        )
      return encryptNotificationSecret(patch.value, userId, field)
    }
    const values = {
      userId,
      gotifyUrl,
      gotifyPriority: data.gotifyPriority,
      gotifyToken: apply('gotifyToken'),
      slackWebhookUrl: apply('slackWebhookUrl'),
      discordWebhookUrl: apply('discordWebhookUrl'),
      updatedAt: new Date(),
    }
    const [saved] = await tx
      .insert(userNotificationSettings)
      .values(values)
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: values,
      })
      .returning()
    return notificationSettingsDto(saved)
  })
}
