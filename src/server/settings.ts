import { eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { userNotificationSettings } from '#/db/schema'

const optionalUrl = z
  .union([z.string().url(), z.literal(''), z.null()])
  .optional()

const SettingsInput = z.object({
  gotifyUrl: optionalUrl,
  gotifyToken: z.union([z.string(), z.literal(''), z.null()]).optional(),
  gotifyPriority: z.coerce.number().int().min(0).max(10).optional(),
  slackWebhookUrl: optionalUrl,
})

export type SettingsDto = {
  userId: string
  gotifyUrl: string | null
  gotifyToken: string | null
  gotifyPriority: number | null
  slackWebhookUrl: string | null
  updatedAt: string
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
        updatedAt: new Date().toISOString(),
      }
    }
    return {
      userId: row.userId,
      gotifyUrl: row.gotifyUrl,
      gotifyToken: row.gotifyToken,
      gotifyPriority: row.gotifyPriority,
      slackWebhookUrl: row.slackWebhookUrl,
      updatedAt: row.updatedAt.toISOString(),
    }
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
          updatedAt: values.updatedAt,
        },
      })
      .returning()
    return {
      userId: row.userId,
      gotifyUrl: row.gotifyUrl,
      gotifyToken: row.gotifyToken,
      gotifyPriority: row.gotifyPriority,
      slackWebhookUrl: row.slackWebhookUrl,
      updatedAt: row.updatedAt.toISOString(),
    }
  })

function emptyToNull(v: string | null | undefined): string | null {
  if (v == null || v === '') return null
  return v
}
