import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { sendDiscordWebhook } from '#/lib/notifications/discord'
import { sendGotify } from '#/lib/notifications/gotify'
import { sendSlackWebhook } from '#/lib/notifications/slack'
import { notificationErrorMessage } from '#/lib/notifications/http'
import { decryptNotificationSecret } from '#/lib/notifications/secrets'
import {
  SettingsInput,
  notificationSettingsDto,
  readNotificationSettings,
  updateNotificationSettings,
} from '#/lib/notifications/settings'

export const getNotificationSettings = createServerFn({
  method: 'GET',
}).handler(async () => {
  const session = await requireSession()
  return notificationSettingsDto(
    await readNotificationSettings(session.user.id),
  )
})

export const saveNotificationSettings = createServerFn({ method: 'POST' })
  .inputValidator((value) => SettingsInput.parse(value))
  .handler(async ({ data }) => {
    const session = await requireSession()
    return updateNotificationSettings(session.user.id, data)
  })

/** Tests use saved credentials so secret values never need to round-trip to the browser. */
export const testNotificationSettings = createServerFn({ method: 'POST' })
  .inputValidator((value) =>
    z.enum(['gotify', 'slack', 'discord']).parse(value),
  )
  .handler(async ({ data: channel }) => {
    const session = await requireSession()
    const settings = await readNotificationSettings(session.user.id)
    if (!settings) throw new Error('Nejprve uložte nastavení kanálu.')
    const text = 'Hlídač ČÚZK — testovací notifikace.'
    try {
      if (channel === 'gotify' && settings.gotifyUrl && settings.gotifyToken) {
        await sendGotify(
          settings.gotifyUrl,
          decryptNotificationSecret(
            settings.gotifyToken,
            session.user.id,
            'gotifyToken',
          ),
          {
            title: 'Hlídač ČÚZK — test',
            message: text,
            priority: settings.gotifyPriority ?? 5,
          },
        )
      } else if (channel === 'slack' && settings.slackWebhookUrl) {
        await sendSlackWebhook(
          decryptNotificationSecret(
            settings.slackWebhookUrl,
            session.user.id,
            'slackWebhookUrl',
          ),
          { text },
        )
      } else if (channel === 'discord' && settings.discordWebhookUrl) {
        await sendDiscordWebhook(
          decryptNotificationSecret(
            settings.discordWebhookUrl,
            session.user.id,
            'discordWebhookUrl',
          ),
          { content: text },
        )
      } else throw new Error('channel_not_configured')
    } catch (error) {
      throw new Error(notificationErrorMessage(error))
    }
    return { ok: true }
  })
