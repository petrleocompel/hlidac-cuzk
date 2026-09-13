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
import { assertEmailRecipient, emailConfigured } from './email'
import { safeTimeZone } from './schedule'

/** Event kinds a user may mark as urgent. */
export const EVENT_KIND_NAMES = [
  'new_rizeni',
  'rizeni_progress',
  'lv_change',
  'parcel_attrs',
  'error',
] as const

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
const minutesOfDay = z.coerce.number().int().min(0).max(1439).nullable()

export const SettingsInput = z.object({
  gotifyUrl: z.string().max(2048).default(''),
  gotifyPriority: z.coerce.number().int().min(0).max(10).default(5),
  gotifyToken: secretPatch,
  slackWebhookUrl: secretPatch,
  discordWebhookUrl: secretPatch,
  useInstanceGotify: z.boolean().default(false),
  ntfyUrl: z.string().max(2048).default(''),
  ntfyToken: secretPatch,
  emailTo: z.string().max(320).default(''),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
      } catch {
        return false
      }
    }, 'Zadejte platné časové pásmo, například Europe/Prague.')
    .default('Europe/Prague'),
  quietFromMinutes: minutesOfDay.default(null),
  quietToMinutes: minutesOfDay.default(null),
  digestMode: z.enum(['off', 'daily', 'weekly']).default('off'),
  digestHour: z.coerce.number().int().min(0).max(23).default(8),
  digestWeekday: z.coerce.number().int().min(1).max(7).default(1),
  urgentKinds: z
    .array(z.enum(EVENT_KIND_NAMES))
    .default(['new_rizeni', 'lv_change']),
})
export type SettingsPatch = z.infer<typeof SettingsInput>
export type SettingsRow = typeof userNotificationSettings.$inferSelect

export function notificationSettingsDto(row: SettingsRow | undefined) {
  const instanceGotify = Boolean(
    process.env.GOTIFY_URL && process.env.GOTIFY_TOKEN,
  )
  return {
    gotifyUrl: displayGotifyUrl(row?.gotifyUrl),
    gotifyPriority: row?.gotifyPriority ?? 5,
    gotifyTokenConfigured: Boolean(row?.gotifyToken),
    /** Instance defaults apply only when the user set no Gotify of their own. */
    gotifyInstanceDefault: instanceGotify,
    useInstanceGotify: row?.useInstanceGotify ?? false,
    slackWebhookConfigured: Boolean(row?.slackWebhookUrl),
    discordWebhookConfigured: Boolean(row?.discordWebhookUrl),
    ntfyUrl: row?.ntfyUrl ?? null,
    ntfyTokenConfigured: Boolean(row?.ntfyToken),
    emailTo: row?.emailTo ?? null,
    emailAvailable: emailConfigured(),
    timezone: row?.timezone ?? 'Europe/Prague',
    quietFromMinutes: row?.quietFromMinutes ?? null,
    quietToMinutes: row?.quietToMinutes ?? null,
    digestMode: row?.digestMode ?? 'off',
    digestHour: row?.digestHour ?? 8,
    digestWeekday: row?.digestWeekday ?? 1,
    urgentKinds: row?.urgentKinds ?? ['new_rizeni', 'lv_change'],
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
    const ntfyUrl = data.ntfyUrl.trim()
      ? normalizeGotifyUrl(data.ntfyUrl.trim())
      : null
    if (
      ntfyUrl &&
      (ntfyUrl !== previous?.ntfyUrl || data.ntfyToken.action === 'replace')
    )
      validateNotificationDestination(ntfyUrl, 'ntfy', policy)
    if (
      previous?.ntfyToken &&
      previous.ntfyUrl !== ntfyUrl &&
      data.ntfyToken.action === 'keep'
    )
      throw new NotificationConfigurationError(
        'Při změně ntfy adresy nahraďte nebo odeberte také token.',
      )
    const emailTo = data.emailTo.trim()
      ? assertEmailRecipient(data.emailTo)
      : null
    if (emailTo && emailTo !== previous?.emailTo && !policy.emailEnabled)
      throw new NotificationConfigurationError(
        'E-mailový kanál správce vypnul.',
      )
    if (emailTo && emailTo !== previous?.emailTo && !emailConfigured())
      throw new NotificationConfigurationError(
        'Správce instance nenastavil SMTP server; e-mail zatím nelze použít.',
      )
    if (
      (data.quietFromMinutes == null) !== (data.quietToMinutes == null) ||
      (data.quietFromMinutes != null &&
        data.quietFromMinutes === data.quietToMinutes)
    )
      throw new NotificationConfigurationError(
        'Klidové hodiny vyžadují odlišný začátek i konec, nebo obojí prázdné.',
      )
    function apply(field: NotificationSecretField) {
      const patch = data[field]
      if (patch.action === 'keep') return previous?.[field] ?? null
      if (patch.action === 'remove') return null
      if (field === 'gotifyToken') {
        if (!gotifyUrl || /[\r\n]/.test(patch.value))
          throw new NotificationConfigurationError(
            'Token vyžaduje povolený Gotify server a nesmí obsahovat konec řádku.',
          )
      } else if (field === 'ntfyToken') {
        if (!ntfyUrl || /[\r\n]/.test(patch.value))
          throw new NotificationConfigurationError(
            'Token vyžaduje povolenou ntfy adresu a nesmí obsahovat konec řádku.',
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
      useInstanceGotify: data.useInstanceGotify,
      ntfyUrl,
      ntfyToken: apply('ntfyToken'),
      emailTo,
      timezone: safeTimeZone(data.timezone),
      quietFromMinutes: data.quietFromMinutes,
      quietToMinutes: data.quietToMinutes,
      digestMode: data.digestMode,
      digestHour: data.digestHour,
      digestWeekday: data.digestWeekday,
      urgentKinds: [...data.urgentKinds],
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
