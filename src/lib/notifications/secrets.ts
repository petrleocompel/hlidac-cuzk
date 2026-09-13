import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
export type NotificationSecretField =
  'gotifyToken' | 'slackWebhookUrl' | 'discordWebhookUrl' | 'ntfyToken'

export class NotificationConfigurationError extends Error {}

function readKey(value = process.env.NOTIFICATION_ENCRYPTION_KEY): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new NotificationConfigurationError(
      'Správce musí nastavit NOTIFICATION_ENCRYPTION_KEY (32 bajtů v base64).',
    )
  }
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new NotificationConfigurationError(
      'Neplatný NOTIFICATION_ENCRYPTION_KEY.',
    )
  }
  return key
}

export function notificationEncryptionConfigured(): boolean {
  try {
    readKey()
    return true
  } catch {
    return false
  }
}

function aad(userId: string, field: NotificationSecretField): Buffer {
  return Buffer.from(JSON.stringify(['notification', 1, userId, field]))
}

export function encryptNotificationSecret(
  value: string,
  userId: string,
  field: NotificationSecretField,
): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', readKey(), iv)
  cipher.setAAD(aad(userId, field))
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return (
    PREFIX +
    Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
  )
}

export function isEncryptedNotificationSecret(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function decryptNotificationSecret(
  value: string,
  userId: string,
  field: NotificationSecretField,
): string {
  if (!isEncryptedNotificationSecret(value)) {
    throw new NotificationConfigurationError(
      'Notifikační údaje vyžadují migraci příkazem notifications:encrypt.',
    )
  }
  const keys = [readKey()]
  if (process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY)
    keys.push(readKey(process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY))
  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url')
  if (payload.length >= 29) {
    for (const key of keys) {
      try {
        const cipher = createDecipheriv(
          'aes-256-gcm',
          key,
          payload.subarray(0, 12),
        )
        cipher.setAuthTag(payload.subarray(12, 28))
        cipher.setAAD(aad(userId, field))
        return Buffer.concat([
          cipher.update(payload.subarray(28)),
          cipher.final(),
        ]).toString('utf8')
      } catch {
        /* Try the previous key during an explicit rotation. */
      }
    }
  }
  throw new NotificationConfigurationError(
    'Notifikační údaje nelze dešifrovat. Správce musí ověřit klíč instance.',
  )
}
