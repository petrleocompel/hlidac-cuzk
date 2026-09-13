import { and, desc, eq, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { pollWatchById } from '#/cron/jobs/poll-parcels'
import type { PollResult } from '#/cron/jobs/poll-parcels'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import type { ParcelWatch } from '#/db/schema'
import { resolveIsknId } from '#/lib/cuzk/client'
import { buildParcelSnapshot } from '#/lib/cuzk/snapshot'
import {
  assertWatchCapacity,
  insertWatchWithinLimit,
} from '#/lib/cuzk/watch-limits'
import { DEFAULT_POLL_MINUTES } from '#/lib/cuzk/policy'
import { retryNotificationDelivery } from '#/lib/notifications/outbox'
import {
  EVENT_KINDS,
  buildEventExport,
  readEventPage,
} from '#/lib/watch-history'
import type {
  WatchEventDto,
  WatchEventPage,
  WatchHistoryExport,
} from '#/lib/watch-history'
import { followDays } from '#/lib/cuzk/rizeni-follow'
import { listTrackedRizeni } from './rizeni'
import type { TrackedRizeniDto } from './rizeni'

const CreateWatchInput = z.object({
  label: z.string().min(1).max(200),
  kuCode: z.string().min(1).max(20),
  kuName: z.string().min(1).max(200),
  parcelNumber: z.coerce.number().int().positive(),
  parcelSubdivision: z.coerce.number().int().positive().nullable().optional(),
  druhCislovani: z.coerce.number().int().min(1).max(2).default(2),
  pollIntervalMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(DEFAULT_POLL_MINUTES),
})

const UpdateWatchInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(200).optional(),
  pollIntervalMinutes: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  enabled: z.boolean().optional(),
})

const IdInput = z.object({ id: z.string().uuid() })

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type WatchDto = {
  id: string
  userId: string
  label: string
  kuCode: string
  kuName: string
  parcelNumber: number
  parcelSubdivision: number | null
  druhCislovani: number
  isknId: string
  pollIntervalMinutes: number
  enabled: boolean
  lastCheckedAt: string | null
  lastAttemptAt: string | null
  lastSuccessfulCheckAt: string | null
  nextCheckAt: string | null
  lastSnapshotJson: Json
  lastError: string | null
  createdAt: string
  updatedAt: string
}

const EventPageInput = z.object({
  id: z.string().uuid(),
  kinds: z.array(z.enum(EVENT_KINDS)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

function asJson(value: unknown): Json {
  return (value ?? null) as Json
}

function toWatchDto(row: ParcelWatch): WatchDto {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    kuCode: row.kuCode,
    kuName: row.kuName,
    parcelNumber: row.parcelNumber,
    parcelSubdivision: row.parcelSubdivision,
    druhCislovani: row.druhCislovani,
    isknId: row.isknId,
    pollIntervalMinutes: row.pollIntervalMinutes,
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastSuccessfulCheckAt: row.lastSuccessfulCheckAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt?.toISOString() ?? null,
    lastSnapshotJson: asJson(row.lastSnapshotJson),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const listWatches = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WatchDto[]> => {
    const session = await requireSession()
    const rows = await db.query.parcelWatches.findMany({
      where: eq(parcelWatches.userId, session.user.id),
      orderBy: [desc(parcelWatches.createdAt)],
    })
    return rows.map(toWatchDto)
  },
)

export const getWatch = createServerFn({ method: 'GET' })
  .inputValidator((v) => IdInput.parse(v))
  .handler(
    async ({
      data,
    }): Promise<{
      watch: WatchDto
      events: WatchEventDto[]
      eventTotal: number
      rizeni: TrackedRizeniDto[]
      rizeniFollowDays: number
    }> => {
      const session = await requireSession()
      const watch = await db.query.parcelWatches.findFirst({
        where: and(
          eq(parcelWatches.id, data.id),
          eq(parcelWatches.userId, session.user.id),
        ),
      })
      if (!watch) throw new Error('not_found')
      const page = await readEventPage(watch.id, {})
      return {
        watch: toWatchDto(watch),
        events: page.events,
        eventTotal: page.total,
        rizeni: await listTrackedRizeni(watch.id),
        rizeniFollowDays: followDays(),
      }
    },
  )

async function requireOwnedWatch(id: string, userId: string) {
  const watch = await db.query.parcelWatches.findFirst({
    where: and(eq(parcelWatches.id, id), eq(parcelWatches.userId, userId)),
    columns: { id: true, label: true, createdAt: true },
  })
  if (!watch) throw new Error('not_found')
  return watch
}

export const listWatchEvents = createServerFn({ method: 'GET' })
  .inputValidator((v) => EventPageInput.parse(v))
  .handler(async ({ data }): Promise<WatchEventPage> => {
    const session = await requireSession()
    const watch = await requireOwnedWatch(data.id, session.user.id)
    return readEventPage(watch.id, data)
  })

const ExportInput = z.object({
  id: z.string().uuid(),
  format: z.enum(['csv', 'json']),
  kinds: z.array(z.enum(EVENT_KINDS)).optional(),
})

export const exportWatchEvents = createServerFn({ method: 'POST' })
  .inputValidator((v) => ExportInput.parse(v))
  .handler(async ({ data }): Promise<WatchHistoryExport> => {
    const session = await requireSession()
    const watch = await requireOwnedWatch(data.id, session.user.id)
    return buildEventExport(watch, data.format, data.kinds)
  })

export const createWatch = createServerFn({ method: 'POST' })
  .inputValidator((v) => CreateWatchInput.parse(v))
  .handler(async ({ data }): Promise<WatchDto> => {
    const session = await requireSession()
    await assertWatchCapacity(session.user.id)
    const { isknId } = await resolveIsknId({
      kodKatastralnihoUzemi: data.kuCode,
      typParcely: 'PKN',
      druhCislovaniParcely: data.druhCislovani as 1 | 2,
      kmenoveCisloParcely: data.parcelNumber,
      poddeleniCislaParcely: data.parcelSubdivision ?? null,
    })

    const now = new Date()
    let snapshot = null as Awaited<
      ReturnType<typeof buildParcelSnapshot>
    > | null
    let lastError: string | null = null
    try {
      snapshot = await buildParcelSnapshot(isknId, now)
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : 'Načtení ČÚZK selhalo.'
    }

    const row = await insertWatchWithinLimit({
      userId: session.user.id,
      label: data.label,
      kuCode: data.kuCode,
      kuName: data.kuName,
      parcelNumber: data.parcelNumber,
      parcelSubdivision: data.parcelSubdivision ?? null,
      druhCislovani: data.druhCislovani,
      isknId,
      pollIntervalMinutes: data.pollIntervalMinutes,
      lastCheckedAt: now,
      lastAttemptAt: now,
      lastSuccessfulCheckAt: snapshot ? now : null,
      nextCheckAt: new Date(
        now.getTime() +
          (snapshot ? data.pollIntervalMinutes * 60_000 : 300_000),
      ),
      lastError,
      lastSnapshotJson: snapshot,
    })

    return toWatchDto(row)
  })

export const updateWatch = createServerFn({ method: 'POST' })
  .inputValidator((v) => UpdateWatchInput.parse(v))
  .handler(async ({ data }): Promise<WatchDto> => {
    const session = await requireSession()
    const existing = await db.query.parcelWatches.findFirst({
      where: and(
        eq(parcelWatches.id, data.id),
        eq(parcelWatches.userId, session.user.id),
      ),
    })
    if (!existing) throw new Error('not_found')

    const [row] = await db
      .update(parcelWatches)
      .set({
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.pollIntervalMinutes !== undefined
          ? { pollIntervalMinutes: data.pollIntervalMinutes }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.enabled === true && !existing.enabled
          ? { nextCheckAt: new Date() }
          : data.pollIntervalMinutes !== undefined
            ? {
                nextCheckAt: sql`coalesce(${parcelWatches.lastAttemptAt}, clock_timestamp()) + ${data.pollIntervalMinutes} * interval '1 minute'`,
              }
            : {}),
        updatedAt: new Date(),
      })
      .where(eq(parcelWatches.id, data.id))
      .returning()

    return toWatchDto(row)
  })

export const refreshWatch = createServerFn({ method: 'POST' })
  .inputValidator((v) => IdInput.parse(v))
  .handler(
    async ({
      data,
    }): Promise<{
      watch: WatchDto
      queued: number
      changeCount: number
      pollStatus: PollResult['status']
    }> => {
      const session = await requireSession()
      const existing = await db.query.parcelWatches.findFirst({
        where: and(
          eq(parcelWatches.id, data.id),
          eq(parcelWatches.userId, session.user.id),
        ),
      })
      if (!existing) throw new Error('not_found')

      const result = await pollWatchById(existing.id, new Date(), {
        manual: true,
      })
      const watch = await db.query.parcelWatches.findFirst({
        where: eq(parcelWatches.id, existing.id),
      })
      if (!watch) throw new Error('not_found')
      return {
        watch: toWatchDto(watch),
        queued: result.queued,
        pollStatus: result.status,
        changeCount: result.changes.length,
      }
    },
  )

export const deleteWatch = createServerFn({ method: 'POST' })
  .inputValidator((v) => IdInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireSession()
    const existing = await db.query.parcelWatches.findFirst({
      where: and(
        eq(parcelWatches.id, data.id),
        eq(parcelWatches.userId, session.user.id),
      ),
    })
    if (!existing) throw new Error('not_found')
    await db.delete(parcelWatches).where(eq(parcelWatches.id, data.id))
    return { ok: true as const }
  })

export const retryDelivery = createServerFn({ method: 'POST' })
  .inputValidator((v) => IdInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireSession()
    await retryNotificationDelivery(data.id, session.user.id)
    return { ok: true }
  })
