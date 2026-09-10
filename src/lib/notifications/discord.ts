/** Native Discord incoming webhook (`content`, not Slack `text`). */
export type DiscordWebhookPayload = {
  content: string
  username?: string
  embeds?: unknown[]
}

const DISCORD_CONTENT_LIMIT = 2000

export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'discord.com' || host === 'discordapp.com'
  } catch {
    return false
  }
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<void> {
  const content = payload.content.slice(0, DISCORD_CONTENT_LIMIT)
  if (!content.trim()) {
    throw new Error('Discord: empty message')
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      username: payload.username ?? 'Hlídač ČÚZK',
      ...(payload.embeds ? { embeds: payload.embeds } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discord webhook ${res.status}: ${body.slice(0, 300)}`)
  }
}
