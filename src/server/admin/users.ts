import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireAdmin } from '#/auth/session'
import { auth } from '#/auth/server'
import { db } from '#/db'
import { ensureDbReady } from '#/db/migrate'
import { parcelWatches, user, userNotificationSettings } from '#/db/schema'

export type AdminUserRow = {
  id: string
  name: string
  email: string
  role: string | null
  banned: boolean | null
  banReason: string | null
  emailVerified: boolean
  createdAt: string
  watchCount: number
}

export type AdminUsersPage = {
  users: AdminUserRow[]
  total: number
  page: number
  pageSize: number
}

export type AdminUserDetail = {
  user: {
    id: string
    name: string
    email: string
    role: string | null
    banned: boolean | null
    banReason: string | null
    banExpires: string | null
    emailVerified: boolean
    createdAt: string
    updatedAt: string
  }
  notifications: {
    gotifyUrl: string | null
    slackWebhookUrl: string | null
    discordWebhookUrl: string | null
  } | null
  watches: Array<{
    id: string
    label: string
    kuName: string
    kuCode: string
    parcelNumber: number
    parcelSubdivision: number | null
    isknId: string
    enabled: boolean
    pollIntervalMinutes: number
    lastSuccessfulCheckAt: string | null
    lastError: string | null
    createdAt: string
  }>
}

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  role: z.enum(['user', 'admin']).optional(),
  banned: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
})

export const listUsersAdmin = createServerFn({ method: 'GET' })
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data }): Promise<AdminUsersPage> => {
    await ensureDbReady()
    await requireAdmin()

    const conditions = []
    if (data.search) {
      const q = `%${data.search}%`
      conditions.push(
        or(ilike(user.email, q), ilike(user.name, q)) ?? sql`true`,
      )
    }
    if (data.role) {
      conditions.push(eq(user.role, data.role))
    }
    if (data.banned === 'yes') {
      conditions.push(eq(user.banned, true))
    } else if (data.banned === 'no') {
      conditions.push(
        or(eq(user.banned, false), sql`${user.banned} is null`) ?? sql`true`,
      )
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const [{ total }] = await db
      .select({ total: count() })
      .from(user)
      .where(where)

    const offset = (data.page - 1) * data.pageSize
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        banned: user.banned,
        banReason: user.banReason,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        watchCount: count(parcelWatches.id),
      })
      .from(user)
      .leftJoin(parcelWatches, eq(parcelWatches.userId, user.id))
      .where(where)
      .groupBy(
        user.id,
        user.name,
        user.email,
        user.role,
        user.banned,
        user.banReason,
        user.emailVerified,
        user.createdAt,
      )
      .orderBy(desc(user.createdAt))
      .limit(data.pageSize)
      .offset(offset)

    return {
      users: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        banned: r.banned,
        banReason: r.banReason,
        emailVerified: r.emailVerified,
        createdAt: r.createdAt.toISOString(),
        watchCount: Number(r.watchCount) || 0,
      })),
      total: Number(total) || 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

const UserIdInput = z.object({ userId: z.string().min(1) })

export const getUserAdmin = createServerFn({ method: 'GET' })
  .inputValidator((d) => UserIdInput.parse(d))
  .handler(async ({ data }): Promise<AdminUserDetail | null> => {
    await ensureDbReady()
    await requireAdmin()

    const row = await db.query.user.findFirst({
      where: eq(user.id, data.userId),
    })
    if (!row) return null

    const notifications = await db.query.userNotificationSettings.findFirst({
      where: eq(userNotificationSettings.userId, data.userId),
    })
    const watches = await db.query.parcelWatches.findMany({
      where: eq(parcelWatches.userId, data.userId),
      orderBy: [desc(parcelWatches.createdAt)],
    })

    return {
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        banned: row.banned,
        banReason: row.banReason,
        banExpires: row.banExpires?.toISOString() ?? null,
        emailVerified: row.emailVerified,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      notifications: notifications
        ? {
            gotifyUrl: notifications.gotifyUrl,
            slackWebhookUrl: notifications.slackWebhookUrl,
            discordWebhookUrl: notifications.discordWebhookUrl,
          }
        : null,
      watches: watches.map((w) => ({
        id: w.id,
        label: w.label,
        kuName: w.kuName,
        kuCode: w.kuCode,
        parcelNumber: w.parcelNumber,
        parcelSubdivision: w.parcelSubdivision,
        isknId: w.isknId,
        enabled: w.enabled,
        pollIntervalMinutes: w.pollIntervalMinutes,
        lastSuccessfulCheckAt: w.lastSuccessfulCheckAt?.toISOString() ?? null,
        lastError: w.lastError,
        createdAt: w.createdAt.toISOString(),
      })),
    }
  })

const SetRoleInput = z.object({
  userId: z.string().min(1),
  role: z.enum(['user', 'admin']),
})

export const setUserRoleAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => SetRoleInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await ensureDbReady()
    const session = await requireAdmin()
    if (data.userId === session.user.id) {
      throw new Error('cannot_change_own_role')
    }
    await auth.api.setRole({
      body: { userId: data.userId, role: data.role },
      headers: getRequest().headers,
    })
    return { ok: true }
  })

const UpdateUserInput = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().optional(),
})

export const updateUserAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => UpdateUserInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; changed: boolean }> => {
    await ensureDbReady()
    await requireAdmin()

    const current = await db.query.user.findFirst({
      where: eq(user.id, data.userId),
      columns: { name: true, email: true },
    })
    if (!current) throw new Error('user_not_found')

    const changes: { name?: string; email?: string; emailVerified?: boolean } =
      {}
    if (data.name !== undefined && data.name !== current.name) {
      changes.name = data.name
    }
    if (data.email !== undefined && data.email !== current.email) {
      changes.email = data.email
      changes.emailVerified = false
    }
    if (Object.keys(changes).length === 0) {
      return { ok: true, changed: false }
    }

    await auth.api.adminUpdateUser({
      body: { userId: data.userId, data: changes },
      headers: getRequest().headers,
    })
    return { ok: true, changed: true }
  })

const SetPasswordInput = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(12).max(200),
})

export const setUserPasswordAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => SetPasswordInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await ensureDbReady()
    await requireAdmin()
    await auth.api.setUserPassword({
      body: { userId: data.userId, newPassword: data.newPassword },
      headers: getRequest().headers,
    })
    return { ok: true }
  })

const BanInput = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
})

export const banUserAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => BanInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await ensureDbReady()
    const session = await requireAdmin()
    if (data.userId === session.user.id) {
      throw new Error('cannot_ban_self')
    }
    await auth.api.banUser({
      body: { userId: data.userId, banReason: data.reason },
      headers: getRequest().headers,
    })
    return { ok: true }
  })

export const unbanUserAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => UserIdInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await ensureDbReady()
    await requireAdmin()
    await auth.api.unbanUser({
      body: { userId: data.userId },
      headers: getRequest().headers,
    })
    return { ok: true }
  })
