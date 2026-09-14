import { readAudit } from '../../src/lib/audit/list'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { verifyPassword } from 'better-auth/crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  account,
  adminAudit,
  parcelWatches,
  rateLimit,
  session,
  ssoProvider,
  user,
  userNotificationSettings,
} from '../../src/db/schema'
import { exportAccount } from '../../src/lib/account-export'
import { recoverLocalPassword } from '../../src/lib/account-recovery'
import { withAuditActor } from '../../src/lib/audit/context'
import { retainAudit } from '../../src/lib/audit/retention'
import { handleAuthRequest } from '../../src/auth/audited'
import { seedAdmin } from '../../src/db/seed-admin'

const password = 'fixture-recovery-password-long'
const base = 'http://127.0.0.1:3000'
function request(path: string, body: unknown, cookie = '') {
  return handleAuthRequest(
    new Request(base + '/api/auth' + path, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    }),
  )
}
function cookies(response: Response) {
  // Browser cookie jar: later Set-Cookie replaces an earlier expiration.
  const jar = new Map<string, string>()
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0]
    jar.set(pair.slice(0, pair.indexOf('=')), pair)
  }
  return [...jar.values()].join('; ')
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
})
beforeEach(async () => {
  await db.delete(ssoProvider)
  await db.delete(user)
  await db.delete(adminAudit)
  await db.delete(rateLimit)
  await db.insert(user).values([
    { id: 'owner', name: 'Owner', email: 'owner@example.test', role: 'user' },
    { id: 'other', name: 'Other', email: 'other@example.test', role: 'user' },
  ])
})
afterAll(async () => {
  await db.delete(ssoProvider)
  await db.delete(user)
  await db.delete(adminAudit)
  await closeDb()
})
it('exports only owned settings and watches and omits credentials and provider URLs', async () => {
  await db.insert(parcelWatches).values([
    {
      userId: 'owner',
      isknId: '1',
      label: 'Own',
      notes: 'private note',
      tags: ['tag'],
    },
    { userId: 'other', isknId: '2', label: 'Foreign SECRET' },
  ])
  await db.insert(userNotificationSettings).values({
    userId: 'owner',
    gotifyUrl: 'http://example.test/SECRET',
    gotifyToken: 'SECRET',
    slackWebhookUrl: 'https://example.test/SECRET',
    discordWebhookUrl: 'https://example.test/SECRET',
    emailTo: 'owner@example.test',
  })
  await recoverLocalPassword({ email: 'owner@example.test', password })
  const exported = await exportAccount('owner')
  expect(exported.watches).toHaveLength(1)
  expect(exported.watches[0]).toMatchObject({
    notes: 'private note',
    tags: ['tag'],
  })
  expect(exported.notifications?.emailTo).toBe('owner@example.test')
  expect(JSON.stringify(exported)).not.toMatch(
    /SECRET|password|gotifyUrl|gotifyToken|slackWebhookUrl|discordWebhookUrl/,
  )
  await expect(exportAccount('missing')).rejects.toThrow('Účet není dostupný')
})
it('recovers an existing account, revokes sessions, preserves bans and roles, and never creates a missing user', async () => {
  await db
    .update(user)
    .set({ banned: true, banReason: 'SECRET' })
    .where(eq(user.id, 'owner'))
  await db.insert(session).values({
    id: 'old-session',
    token: 'SECRET',
    userId: 'owner',
    expiresAt: new Date(Date.now() + 3600000),
  })
  await recoverLocalPassword({ email: 'OWNER@example.test', password })
  const credential = await db.query.account.findFirst({
    where: eq(account.userId, 'owner'),
  })
  expect(await verifyPassword({ hash: credential!.password!, password })).toBe(
    true,
  )
  expect(await db.query.session.findMany()).toHaveLength(0)
  expect(
    await db.query.user.findFirst({ where: eq(user.id, 'owner') }),
  ).toMatchObject({ role: 'user', banned: true })
  expect(
    await db.query.adminAudit.findMany({
      where: eq(adminAudit.action, 'password.changed'),
    }),
  ).toMatchObject([{ actorId: 'local-cli', targetId: 'owner', details: {} }])
  await expect(
    recoverLocalPassword({ email: 'missing@example.test', password }),
  ).rejects.toThrow('Účet nebyl nalezen')
  expect(await db.query.user.findMany()).toHaveLength(2)
  expect(JSON.stringify(await db.query.adminAudit.findMany())).not.toMatch(
    /SECRET|fixture-recovery/,
  )
})
it('audits actual admin API role, ban and impersonation mutations with verified actor; rejects anonymous calls', async () => {
  await seedAdmin({ email: 'admin@example.test', password })
  const admin = await db.query.user.findFirst({
    where: eq(user.email, 'admin@example.test'),
  })
  const login = await request('/sign-in/email', {
    email: 'admin@example.test',
    password,
  })
  expect(login.status).toBe(200)
  const cookie = cookies(login)
  await db.delete(adminAudit)
  const denied = await request('/admin/set-role', {
    userId: 'owner',
    role: 'admin',
  })
  expect(denied.status).toBeGreaterThanOrEqual(400)
  expect(await db.query.adminAudit.findMany()).toHaveLength(0)
  expect(
    (
      await request(
        '/admin/set-role',
        { userId: 'owner', role: 'admin' },
        cookie,
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await request(
        '/admin/ban-user',
        { userId: 'other', banReason: 'SECRET' },
        cookie,
      )
    ).status,
  ).toBe(200)
  expect(
    (await request('/admin/unban-user', { userId: 'other' }, cookie)).status,
  ).toBe(200)
  const impersonation = await request(
    '/admin/impersonate-user',
    { userId: 'other' },
    cookie,
  )
  expect(impersonation.status).toBe(200)
  expect(
    (await request('/admin/stop-impersonating', {}, cookies(impersonation)))
      .status,
  ).toBe(200)
  const rows = await db.query.adminAudit.findMany()
  expect(rows.map((r) => r.action)).toEqual(
    expect.arrayContaining([
      'user.role_changed',
      'user.ban_changed',
      'impersonation.started',
      'impersonation.session_removed',
    ]),
  )
  expect(rows.every((r) => r.actorId === admin!.id)).toBe(true)
  expect(JSON.stringify(rows)).not.toContain('SECRET')
})
it('isolates concurrent audit actors, redacts SSO config and rolls back mutations with their audit', async () => {
  await Promise.all(
    ['owner', 'other'].map((id) =>
      withAuditActor(id, (tx) =>
        tx.update(user).set({ role: 'admin' }).where(eq(user.id, id)),
      ),
    ),
  )
  expect(
    (await db.query.adminAudit.findMany()).every(
      (r) => r.actorId === r.targetId,
    ),
  ).toBe(true)
  await withAuditActor('owner', (tx) =>
    tx.insert(ssoProvider).values({
      id: 'sso',
      providerId: 'fixture',
      issuer: 'https://example.test/SECRET',
      domain: '*',
      oidcConfig: '{"clientSecret":"SECRET"}',
    }),
  )
  const sso = await db.query.adminAudit.findFirst({
    where: eq(adminAudit.action, 'sso.insert'),
  })
  expect(sso?.details).toMatchObject({
    changedFields: expect.arrayContaining(['oidc_config']),
  })
  expect(JSON.stringify(sso)).not.toContain('SECRET')
  await expect(
    withAuditActor('owner', async (tx) => {
      await tx.update(user).set({ role: 'user' }).where(eq(user.id, 'other'))
      throw new Error('rollback')
    }),
  ).rejects.toThrow('rollback')
  expect(
    await db.query.adminAudit.findMany({
      where: eq(adminAudit.action, 'user.role_changed'),
    }),
  ).toHaveLength(2)
  await db.update(user).set({ role: 'user' }).where(eq(user.id, 'other'))
  const [latest] = await db.execute(
    sql`select actor_id from admin_audit where target_id = 'other' order by created_at desc limit 1`,
  )
  expect(latest.actor_id).toBeNull()
})
it('audit insert failure also aborts the protected mutation', async () => {
  await db.execute(
    sql`alter table admin_audit add constraint fixture_reject_audit check (action <> 'user.role_changed')`,
  )
  try {
    await expect(
      withAuditActor('owner', (tx) =>
        tx.update(user).set({ role: 'admin' }).where(eq(user.id, 'other')),
      ),
    ).rejects.toThrow()
    expect(
      (await db.query.user.findFirst({ where: eq(user.id, 'other') }))?.role,
    ).toBe('user')
  } finally {
    await db.execute(
      sql`alter table admin_audit drop constraint fixture_reject_audit`,
    )
  }
})
it('retains audit for a bounded period, dry runs without deletion, and limits each batch', async () => {
  await db.insert(adminAudit).values(
    Array.from({ length: 1002 }, () => ({
      targetId: 'deleted-user',
      action: 'user.deleted',
      createdAt: new Date('2020-01-01Z'),
    })),
  )
  await db
    .insert(adminAudit)
    .values({ targetId: 'recent', action: 'user.deleted' })
  expect(await retainAudit({ policy: {} })).toBe(1000)
  expect(await db.query.adminAudit.findMany()).toHaveLength(1003)
  expect(await retainAudit({ apply: true, policy: {} })).toBe(1000)
  expect(await retainAudit({ apply: true, policy: {} })).toBe(2)
  expect(await db.query.adminAudit.findMany()).toMatchObject([
    { targetId: 'recent' },
  ])
  await expect(
    retainAudit({ policy: { AUDIT_RETENTION_DAYS: 0 } }),
  ).rejects.toThrow()
})
it('CLI accepts a private password file, refuses shared permissions and never prints the password', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hlidac-recovery-'))
  const file = join(dir, 'password')
  try {
    await writeFile(file, password + '\n', { mode: 0o600 })
    const args = [
      '--import',
      'tsx',
      'scripts/recover-password.ts',
      '--email',
      'owner@example.test',
      '--password-file',
      file,
    ]
    const result = await promisify(execFile)(process.execPath, args, {
      env: process.env,
    })
    expect(result.stdout).toContain('Heslo změněno')
    expect(result.stdout + result.stderr).not.toContain(password)
    await chmod(file, 0o644)
    await expect(
      promisify(execFile)(process.execPath, args, { env: process.env }),
    ).rejects.toMatchObject({ code: 1 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('paginates audit entries sharing microsecond timestamps without gaps or duplicates', async () => {
  await db.execute(
    sql`insert into admin_audit(target_id,action,created_at) select 'page-' || n,'user.deleted','2026-09-14T08:00:00.123456Z'::timestamptz from generate_series(1,101) n`,
  )
  const first = await readAudit()
  expect(first.items).toHaveLength(50)
  expect(first.next?.at).toBe('2026-09-14T08:00:00.123456Z')
  const second = await readAudit(first.next!)
  const third = await readAudit(second.next!)
  expect(second.items).toHaveLength(50)
  expect(third.items).toHaveLength(1)
  expect(third.next).toBeNull()
  expect(
    new Set([...first.items, ...second.items, ...third.items].map((r) => r.id))
      .size,
  ).toBe(101)
})
