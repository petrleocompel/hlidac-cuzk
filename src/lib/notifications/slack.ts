/** Slack-compatible incoming webhook payload (also works with Discord slack mode). */
export type SlackWebhookPayload = {
  text: string
  blocks?: unknown[]
}

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackWebhookPayload,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 300)}`)
  }
}
