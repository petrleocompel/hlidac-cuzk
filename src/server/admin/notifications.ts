import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAdmin } from '#/auth/session'
import { db } from '#/db'
import { notificationPolicy } from '#/db/schema'
import { readNotificationPolicy } from '#/lib/notifications/policy'
import { normalizeGotifyUrl } from '#/lib/notifications/destinations'

export const getNotificationPolicyAdmin = createServerFn({
  method: 'GET',
}).handler(async () => {
  await requireAdmin()
  const policy = await readNotificationPolicy()
  return {
    gotifyEnabled: policy.gotifyEnabled,
    slackEnabled: policy.slackEnabled,
    discordEnabled: policy.discordEnabled,
    gotifyAllowedUrls: policy.gotifyAllowedUrls,
  }
})
export const saveNotificationPolicyAdmin = createServerFn({ method: 'POST' })
  .inputValidator((value) =>
    z
      .object({
        gotifyEnabled: z.boolean(),
        slackEnabled: z.boolean(),
        discordEnabled: z.boolean(),
        gotifyAllowedUrls: z.array(z.string().max(2048)).max(100),
      })
      .parse(value),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const values = {
      ...data,
      gotifyAllowedUrls: [
        ...new Set(data.gotifyAllowedUrls.map(normalizeGotifyUrl)),
      ],
      updatedAt: new Date(),
    }
    await db
      .insert(notificationPolicy)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: notificationPolicy.id, set: values })
    return { ok: true }
  })
