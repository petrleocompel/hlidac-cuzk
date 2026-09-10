export type GotifyMessage = {
  title: string
  message: string
  priority?: number
}

export async function sendGotify(
  baseUrl: string,
  token: string,
  msg: GotifyMessage,
): Promise<void> {
  const url = new URL('/message', baseUrl.replace(/\/$/, ''))
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gotify-Key': token,
    },
    body: JSON.stringify({
      title: msg.title,
      message: msg.message,
      priority: msg.priority ?? 5,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gotify ${res.status}: ${body.slice(0, 300)}`)
  }
}
