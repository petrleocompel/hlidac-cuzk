import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { notificationPolicy } from '#/db/schema'

export type NotificationPolicy = {
  gotifyEnabled: boolean
  slackEnabled: boolean
  discordEnabled: boolean
  ntfyEnabled: boolean
  emailEnabled: boolean
  gotifyAllowedUrls: string[]
  ntfyAllowedUrls: string[]
}

function allowList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
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
      ntfyEnabled: true,
      emailEnabled: true,
      gotifyAllowedUrls: allowList(process.env.GOTIFY_ALLOWED_URLS),
      ntfyAllowedUrls: allowList(process.env.NTFY_ALLOWED_URLS),
    }
  )
}
