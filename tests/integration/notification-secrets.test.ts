import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  notificationPolicy,
  user,
  userNotificationSettings,
} from '../../src/db/schema'
import {
  SettingsInput,
  notificationSettingsDto,
  readNotificationSettings,
  updateNotificationSettings,
} from '../../src/lib/notifications/settings'
import {
  decryptNotificationSecret,
  encryptNotificationSecret,
} from '../../src/lib/notifications/secrets'
import { migrateNotificationSecrets } from '../../src/lib/notifications/migrate-secrets'
import { readNotificationPolicy } from '../../src/lib/notifications/policy'

const key = Buffer.alloc(32, 7).toString('base64')
const gotify = 'http://127.0.0.1:12345/gotify'
const slack = 'https://hooks.slack.com/services/TTEST/BTEST/fixture'
const owner = 'notification-owner'
const patch = () =>
  SettingsInput.parse({
    gotifyUrl: gotify,
    gotifyToken: { action: 'replace', value: 'fixture-token' },
    slackWebhookUrl: { action: 'replace', value: slack },
  })
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
})
beforeEach(async () => {
  process.env.NOTIFICATION_ENCRYPTION_KEY = key
  delete process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY
  delete process.env.GOTIFY_ALLOWED_URLS
  await db.delete(notificationPolicy)
  await db.delete(user)
  await db
    .insert(user)
    .values({ id: owner, name: 'Fixture', email: 'notification@example.test' })
})
afterAll(async () => {
  process.env.NOTIFICATION_ENCRYPTION_KEY = key
  delete process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY
  await db.delete(notificationPolicy)
  await closeDb()
})

describe('notification secrets and administrator policy', () => {
  it('stores only randomized authenticated ciphertext and returns only configured flags', async () => {
    const dto = await updateNotificationSettings(owner, patch())
    const row = (await readNotificationSettings(owner))!
    expect(dto.gotifyTokenConfigured).toBe(true)
    expect(dto.slackWebhookConfigured).toBe(true)
    expect(JSON.stringify(dto)).not.toContain('fixture')
    expect(dto).not.toHaveProperty('gotifyToken')
    expect(dto).not.toHaveProperty('slackWebhookUrl')
    expect(row.gotifyToken).toMatch(/^enc:v1:/)
    expect(row.slackWebhookUrl).not.toContain('hooks.slack')
    expect(
      decryptNotificationSecret(row.gotifyToken!, owner, 'gotifyToken'),
    ).toBe('fixture-token')
    expect(
      encryptNotificationSecret('fixture-token', owner, 'gotifyToken'),
    ).not.toBe(row.gotifyToken)
    expect(() =>
      decryptNotificationSecret(row.gotifyToken!, 'other-owner', 'gotifyToken'),
    ).toThrow('dešifrovat')
    expect(() =>
      decryptNotificationSecret(row.gotifyToken!, owner, 'slackWebhookUrl'),
    ).toThrow('dešifrovat')
    const tampered = Buffer.from(row.gotifyToken!.slice(7), 'base64url')
    tampered[13] ^= 1
    expect(() =>
      decryptNotificationSecret(
        'enc:v1:' + tampered.toString('base64url'),
        owner,
        'gotifyToken',
      ),
    ).toThrow('dešifrovat')
  })
  it('keeps omitted secrets, removes explicitly, and refuses moving a kept token to another server', async () => {
    await updateNotificationSettings(owner, patch())
    const original = (await readNotificationSettings(owner))!.gotifyToken
    await updateNotificationSettings(
      owner,
      SettingsInput.parse({
        gotifyUrl: gotify,
        slackWebhookUrl: { action: 'remove' },
      }),
    )
    expect((await readNotificationSettings(owner))!.gotifyToken).toBe(original)
    expect((await readNotificationSettings(owner))!.slackWebhookUrl).toBeNull()
    await expect(
      updateNotificationSettings(
        owner,
        SettingsInput.parse({ gotifyUrl: 'http://other.test' }),
      ),
    ).rejects.toThrow('nahraďte')
    await updateNotificationSettings(
      owner,
      SettingsInput.parse({ gotifyToken: { action: 'remove' } }),
    )
    expect((await readNotificationSettings(owner))!.gotifyToken).toBeNull()
  })
  it('serializes concurrent changes without losing a kept secret', async () => {
    await updateNotificationSettings(owner, patch())
    await Promise.all([
      updateNotificationSettings(
        owner,
        SettingsInput.parse({
          gotifyUrl: gotify,
          slackWebhookUrl: { action: 'remove' },
        }),
      ),
      updateNotificationSettings(
        owner,
        SettingsInput.parse({
          gotifyUrl: gotify,
          gotifyToken: { action: 'replace', value: 'replacement' },
        }),
      ),
    ])
    const row = (await readNotificationSettings(owner))!
    expect(row.slackWebhookUrl).toBeNull()
    expect(
      decryptNotificationSecret(row.gotifyToken!, owner, 'gotifyToken'),
    ).toBe('replacement')
  })
  it('migrates plaintext in a separate CLI and rotates with rollback on the wrong key', async () => {
    await db
      .insert(userNotificationSettings)
      .values({
        userId: owner,
        gotifyUrl: gotify,
        gotifyToken: 'legacy-fixture',
        slackWebhookUrl: slack,
      })
    expect(
      JSON.stringify(
        notificationSettingsDto(await readNotificationSettings(owner)),
      ),
    ).not.toContain('legacy-fixture')
    expect(() =>
      decryptNotificationSecret('legacy-fixture', owner, 'gotifyToken'),
    ).toThrow('migraci')
    const result = await promisify(execFile)(
      'pnpm',
      ['notifications:encrypt'],
      { env: process.env },
    )
    expect(result.stdout).toContain('2 hodnot')
    expect(result.stdout + result.stderr).not.toContain('legacy-fixture')
    const original = (await readNotificationSettings(owner))!
    process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    )
    await expect(migrateNotificationSecrets()).rejects.toThrow('dešifrovat')
    expect((await readNotificationSettings(owner))!.gotifyToken).toBe(
      original.gotifyToken,
    )
    process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY = key
    expect(await migrateNotificationSecrets()).toBe(2)
    delete process.env.NOTIFICATION_PREVIOUS_ENCRYPTION_KEY
    const rotated = (await readNotificationSettings(owner))!
    expect(
      decryptNotificationSecret(rotated.gotifyToken!, owner, 'gotifyToken'),
    ).toBe('legacy-fixture')
    expect(rotated.gotifyToken).not.toBe(original.gotifyToken)
  })
  it('fails closed without a valid key without leaking credentials', async () => {
    delete process.env.NOTIFICATION_ENCRYPTION_KEY
    await expect(updateNotificationSettings(owner, patch())).rejects.toThrow(
      'NOTIFICATION_ENCRYPTION_KEY',
    )
    expect(await readNotificationSettings(owner)).toBeUndefined()
  })
  it('uses env defaults until the administrator saves a policy, including an empty whitelist override', async () => {
    process.env.GOTIFY_ALLOWED_URLS = 'http://allowed.test'
    await expect(updateNotificationSettings(owner, patch())).rejects.toThrow(
      'Nepovolený',
    )
    await db.insert(notificationPolicy).values({ id: 1, gotifyAllowedUrls: [] })
    await updateNotificationSettings(owner, patch())
    expect((await readNotificationPolicy()).gotifyAllowedUrls).toEqual([])
    await db
      .update(notificationPolicy)
      .set({ gotifyEnabled: false })
      .where(eq(notificationPolicy.id, 1))
    await expect(updateNotificationSettings(owner, patch())).rejects.toThrow(
      'správce vypnul',
    )
  })
})
