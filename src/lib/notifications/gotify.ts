import { postNotification } from './http'

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
  await postNotification(url, {
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
}
