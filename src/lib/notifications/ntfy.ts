import { postNotification } from './http'

export type NtfyMessage = {
  title: string
  message: string
}

/**
 * Publishes to a topic URL. The title travels in a header, so it must stay on
 * one line; the body carries the message itself.
 */
export async function sendNtfy(
  topicUrl: string,
  token: string | null,
  msg: NtfyMessage,
): Promise<void> {
  await postNotification(
    topicUrl,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: `=?UTF-8?B?${Buffer.from(msg.title.replace(/[\r\n]+/g, ' ').slice(0, 200)).toString('base64')}?=`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: msg.message,
    },
    'ntfy',
  )
}
