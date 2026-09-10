import { isDiscordWebhookUrl, sendDiscordWebhook } from './discord'

/** Slack incoming webhook payload. */
export type SlackWebhookPayload = {
  text: string
  blocks?: unknown[]
}

/**
 * Send to a Slack incoming webhook.
 * If the URL is a Discord webhook pasted by mistake, fall back to Discord
 * native payload (`content`) so the UI test does not fail with code 50006.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackWebhookPayload,
): Promise<void> {
  if (isDiscordWebhookUrl(webhookUrl)) {
    await sendDiscordWebhook(webhookUrl, { content: payload.text })
    return
  }

  const text = payload.text.trim()
  if (!text) throw new Error('Slack: empty message')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(payload.blocks ? { blocks: payload.blocks } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 300)}`)
  }
}
