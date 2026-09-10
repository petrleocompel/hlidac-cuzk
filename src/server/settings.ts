import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { userNotificationSettings } from '#/db/schema'
import { sendDiscordWebhook } from '#/lib/notifications/discord'
import { sendGotify } from '#/lib/notifications/gotify'
import { sendSlackWebhook } from '#/lib/notifications/slack'

const optionalUrl = z
  .union([z.string().url(), z.literal(''), z.null()])
  .optional()

const SettingsInput = z.object({
  gotifyUrl: optionalUrl,
  gotifyToken: z.union([z.string(), z.literal(''), z.null()]).optional(),
  gotifyPriority: z.coerce.number().int().min(0).max(10).optional(),
  slackWebhookUrl: optionalUrl,
  discordWebhookUrl: optionalUrl,
})

export type SettingsDto = {
  userId: string
  gotifyUrl: string | null
  gotifyToken: string | null
  gotifyPriority: number | null
  slackWebhookUrl: string | null
  discordWebhookUrl: string | null
  updatedAt: string
}

function toDto(row: {
  userId: string
  gotifyUrl: string | null
  gotifyToken: string | null
  gotifyPriority: number | null
  slackWebhookUrl: string | null
  discordWebhookUrl: string | null
  updatedAt: Date
}): SettingsDto {
  return {
    userId: row.userId,
    gotifyUrl: row.gotifyUrl,
    gotifyToken: row.gotifyToken,
    gotifyPriority: row.gotifyPriority,
    slackWebhookUrl: row.slackWebhookUrl,
    discordWebhookUrl: row.discordWebhookUrl,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const getNotificationSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SettingsDto> => {
    const session = await requireSession()
    const row = await db.query.userNotificationSettings.findFirst({
      where: eq(userNotificationSettings.userId, session.user.id),
    })
    if (!row) {
      return {
        userId: session.user.id,
        gotifyUrl: null,
        gotifyToken: null,
        gotifyPriority: 5,
        slackWebhookUrl: null,
        discordWebhookUrl: null,
        updatedAt: new Date().toISOString(),
      }
    }
    return toDto(row)
  },
)

export const saveNotificationSettings = createServerFn({ method: 'POST' })
  .inputValidator((v) => SettingsInput.parse(v))
  .handler(async ({ data }): Promise<SettingsDto> => {
    const session = await requireSession()
    const values = {
      userId: session.user.id,
      gotifyUrl: emptyToNull(data.gotifyUrl),
      gotifyToken: emptyToNull(data.gotifyToken),
      gotifyPriority: data.gotifyPriority ?? 5,
      slackWebhookUrl: emptyToNull(data.slackWebhookUrl),
      discordWebhookUrl: emptyToNull(data.discordWebhookUrl),
      updatedAt: new Date(),
    }
    const [row] = await db
      .insert(userNotificationSettings)
      .values(values)
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: {
          gotifyUrl: values.gotifyUrl,
          gotifyToken: values.gotifyToken,
          gotifyPriority: values.gotifyPriority,
          slackWebhookUrl: values.slackWebhookUrl,
          discordWebhookUrl: values.discordWebhookUrl,
          updatedAt: values.updatedAt,
        },
      })
      .returning()
    return toDto(row)
  })

function emptyToNull(v: string | null | undefined): string | null {
  if (v == null || v === '') return null
  return v
}

const TestGotifyInput = z.object({
  gotifyUrl: z.string().url(),
  gotifyToken: z.string().min(1),
  gotifyPriority: z.coerce.number().int().min(0).max(10).default(5),
})

const TestSlackInput = z.object({
  slackWebhookUrl: z.string().url(),
})

const TestDiscordInput = z.object({
  discordWebhookUrl: z.string().url(),
})

export const testGotifyNotification = createServerFn({ method: 'POST' })
  .inputValidator((v) => TestGotifyInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await requireSession()
    await sendGotify(data.gotifyUrl, data.gotifyToken, {
      title: 'Hlídač ČÚZK — test',
      message:
        'Testovací notifikace z nastavení. Pokud tohle vidíte, Gotify funguje.',
      priority: data.gotifyPriority,
    })
    return { ok: true as const }
  })

export const testSlackNotification = createServerFn({ method: 'POST' })
  .inputValidator((v) => TestSlackInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await requireSession()
    await sendSlackWebhook(data.slackWebhookUrl, {
      text: '*Hlídač ČÚZK — test*\nTestovací notifikace z nastavení. Pokud tohle vidíte, webhook funguje.',
    })
    return { ok: true as const }
  })

export const testDiscordNotification = createServerFn({ method: 'POST' })
  .inputValidator((v) => TestDiscordInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await requireSession()
    await sendDiscordWebhook(data.discordWebhookUrl, {
      content:
        '**Hlídač ČÚZK — test**\nTestovací notifikace z nastavení. Pokud tohle vidíte, Discord webhook funguje.',
    })
    return { ok: true as const }
  })
