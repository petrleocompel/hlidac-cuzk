import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { notificationPolicy } from '#/db/schema'

export type NotificationPolicy = {
  gotifyEnabled: boolean
  slackEnabled: boolean
  discordEnabled: boolean
  gotifyAllowedUrls: string[]
}

export async function readNotificationPolicy(): Promise<NotificationPolicy> {
  const row = await db.query.notificationPolicy.findFirst({
    where: eq(notificationPolicy.id, 1),
  })
  return (
    row ?? {
      gotifyEnabled: true,
      slackEnabled: true,
      discordEnabled: true,
      gotifyAllowedUrls: (process.env.GOTIFY_ALLOWED_URLS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }
  )
}
