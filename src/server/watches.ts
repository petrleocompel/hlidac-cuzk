import { and, desc, eq, sql } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { pollWatchById } from '#/cron/jobs/poll-parcels'
import type { PollResult } from '#/cron/jobs/poll-parcels'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import type { ParcelWatch } from '#/db/schema'
import { assertWatchCapacity } from '#/lib/cuzk/watch-limits'
import {
  createVerifiedObjectWatch,
  createVerifiedWatch,
  importVerifiedWatches,
} from '#/lib/cuzk/watch-create'
import { OBJECT_TYPES } from '#/lib/cuzk/object-snapshot'
import type { ImportOutcome } from '#/lib/cuzk/watch-create'
import { planWatchImport } from '#/lib/cuzk/watch-import'
import type { ImportPlan } from '#/lib/cuzk/watch-import'
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
import type { TrackedRizeniDto } from '#/lib/cuzk/rizeni-dto'

const PollIntervalInput = z.coerce
  .number()
  .int()
  .min(5)
  .max(24 * 60)
  .default(DEFAULT_POLL_MINUTES)

/** Only the register, the confirmed ISKN id and the user's own label. */
const CreateWatchInput = z.object({
  objectType: z.enum(OBJECT_TYPES).default('parcel'),
  isknId: z.string().regex(/^[1-9]\d{0,27}$/),
  label: z.string().max(200).optional(),
  pollIntervalMinutes: PollIntervalInput,
})

const ImportInput = z.object({
  content: z.string().min(1).max(1_000_000),
  format: z.enum(['csv', 'json']),
})

const UpdateWatchInput = z.object({
  notifyKinds: z.array(z.enum(EVENT_KINDS)).nullable().optional(),
  notifyChannels: z
    .array(z.enum(['gotify', 'slack', 'discord', 'ntfy', 'email']))
    .nullable()
    .optional(),
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
  notifyKinds: string[] | null
  notifyChannels: string[] | null
  id: string
  userId: string
  label: string
  objectType: ParcelWatch['objectType']
  objectSummary: string | null
  kuCode: string | null
  kuName: string | null
  parcelNumber: number | null
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
    notifyKinds: row.notifyKinds,
    notifyChannels: row.notifyChannels,
    userId: row.userId,
    label: row.label,
    objectType: row.objectType,
    objectSummary: row.objectSummary,
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
  .inputValidator((v) =>
    IdInput.extend({ eventId: z.string().uuid().optional() }).parse(v),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      watch: WatchDto
      events: WatchEventDto[]
      focusedEvents: WatchEventDto[]
      eventTotal: number
      rizeni: TrackedRizeniDto[]
      rizeniFollowDays: number
      /** Objects this user already watches, so links do not spend an API call. */
      watchedObjects: Array<{
        id: string
        objectType: ParcelWatch['objectType']
        isknId: string
      }>
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
      const { listTrackedRizeni } = await import('./rizeni.server')
      return {
        watch: toWatchDto(watch),
        events: page.events,
        focusedEvents: data.eventId
          ? (await readEventPage(watch.id, { eventId: data.eventId })).events
          : [],
        eventTotal: page.total,
        rizeni: await listTrackedRizeni(watch.id),
        rizeniFollowDays: followDays(),
        watchedObjects: await db
          .select({
            id: parcelWatches.id,
            objectType: parcelWatches.objectType,
            isknId: parcelWatches.isknId,
          })
          .from(parcelWatches)
          .where(eq(parcelWatches.userId, session.user.id)),
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
    const row =
      data.objectType === 'parcel'
        ? await createVerifiedWatch({
            userId: session.user.id,
            isknId: data.isknId,
            label: data.label,
            pollIntervalMinutes: data.pollIntervalMinutes,
          })
        : await createVerifiedObjectWatch({
            userId: session.user.id,
            objectType: data.objectType,
            isknId: data.isknId,
            label: data.label,
            pollIntervalMinutes: data.pollIntervalMinutes,
          })
    return toWatchDto(row)
  })

/** Validation and duplicate detection only; no ČÚZK call is spent on a preview. */
export const previewWatchImport = createServerFn({ method: 'POST' })
  .inputValidator((v) => ImportInput.parse(v))
  .handler(async ({ data }): Promise<ImportPlan & { error?: string }> => {
    const session = await requireSession()
    const existing = await db
      .select({
        kuCode: parcelWatches.kuCode,
        parcelNumber: parcelWatches.parcelNumber,
        parcelSubdivision: parcelWatches.parcelSubdivision,
        druhCislovani: parcelWatches.druhCislovani,
      })
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, session.user.id))
    return planWatchImport(data.content, data.format, existing)
  })

export const runWatchImport = createServerFn({ method: 'POST' })
  .inputValidator((v) => ImportInput.parse(v))
  .handler(async ({ data }): Promise<ImportOutcome> => {
    const session = await requireSession()
    // Re-planned server side: the preview the browser saw is not authoritative.
    const existing = await db
      .select({
        kuCode: parcelWatches.kuCode,
        parcelNumber: parcelWatches.parcelNumber,
        parcelSubdivision: parcelWatches.parcelSubdivision,
        druhCislovani: parcelWatches.druhCislovani,
      })
      .from(parcelWatches)
      .where(eq(parcelWatches.userId, session.user.id))
    const plan = planWatchImport(data.content, data.format, existing)
    if (plan.error) throw new Error(plan.error)
    if (!plan.ready)
      throw new Error('Soubor neobsahuje žádný platný nový řádek.')
    await assertWatchCapacity(session.user.id)
    return importVerifiedWatches(session.user.id, plan)
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
        ...(data.notifyKinds !== undefined
          ? { notifyKinds: data.notifyKinds }
          : {}),
        ...(data.notifyChannels !== undefined
          ? { notifyChannels: data.notifyChannels }
          : {}),
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
