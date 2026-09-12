import { postNotification } from './http'

/** Slack incoming webhook payload. */
export type SlackWebhookPayload = {
  text: string
  blocks?: unknown[]
}

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackWebhookPayload,
): Promise<void> {
  const text = payload.text.trim()
  if (!text) throw new Error('Slack: empty message')

  await postNotification(
    webhookUrl,
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(payload.blocks ? { blocks: payload.blocks } : {}),
      }),
    },
    'slack',
  )
}
