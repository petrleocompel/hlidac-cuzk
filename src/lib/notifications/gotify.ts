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
  await postNotification(
    baseUrl,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Gotify-Key': token,
      },
      body: JSON.stringify({
        title: msg.title,
        message: msg.message,
        priority: msg.priority ?? 5,
      }),
    },
    'gotify',
  )
}
