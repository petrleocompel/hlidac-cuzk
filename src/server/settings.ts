import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { sendToChannel } from '#/lib/notifications/outbox'
import { notificationErrorMessage } from '#/lib/notifications/http'
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
    z.enum(['gotify', 'slack', 'discord', 'ntfy', 'email']).parse(value),
  )
  .handler(async ({ data: channel }) => {
    const session = await requireSession()
    const settings = await readNotificationSettings(session.user.id)
    if (!settings) throw new Error('Nejprve uložte nastavení kanálu.')
    const text = 'Hlídač ČÚZK — testovací notifikace.'
    try {
      await sendToChannel(channel, session.user.id, settings, {
        title: 'Hlídač ČÚZK — test',
        message: text,
      })
    } catch (error) {
      throw new Error(notificationErrorMessage(error))
    }
    return { ok: true }
  })
