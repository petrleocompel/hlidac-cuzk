import { and, desc, eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { pollWatchById } from '#/cron/jobs/poll-parcels'
import type { PollResult } from '#/cron/jobs/poll-parcels'
import { db } from '#/db'
import { parcelWatches, watchEvents } from '#/db/schema'
import type { NotificationDelivery, ParcelWatch, WatchEvent } from '#/db/schema'
import { resolveIsknId } from '#/lib/cuzk/client'
import { buildParcelSnapshot } from '#/lib/cuzk/snapshot'
import { retryNotificationDelivery } from '#/lib/notifications/outbox'

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
    .default(60),
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
  lastSnapshotJson: Json
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type NotificationDeliveryDto = {
  id: string
  channel: NotificationDelivery['channel']
  status: NotificationDelivery['status']
  attemptCount: number
  nextAttemptAt: string
  sentAt: string | null
  lastError: string | null
}

export type WatchEventDto = {
  id: string
  watchId: string
  deliveries: NotificationDeliveryDto[]
  kind: string
  payloadJson: Json
  createdAt: string
}

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
    lastSnapshotJson: asJson(row.lastSnapshotJson),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toEventDto(
  row: WatchEvent & { deliveries: NotificationDelivery[] },
): WatchEventDto {
  return {
    id: row.id,
    watchId: row.watchId,
    deliveries: row.deliveries.map((delivery) => ({
      id: delivery.id,
      channel: delivery.channel,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      sentAt: delivery.sentAt?.toISOString() ?? null,
      lastError: delivery.lastError,
    })),
    kind: row.kind,
    payloadJson: asJson(row.payloadJson),
    createdAt: row.createdAt.toISOString(),
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
    async ({ data }): Promise<{ watch: WatchDto; events: WatchEventDto[] }> => {
      const session = await requireSession()
      const watch = await db.query.parcelWatches.findFirst({
        where: and(
          eq(parcelWatches.id, data.id),
          eq(parcelWatches.userId, session.user.id),
        ),
      })
      if (!watch) throw new Error('not_found')
      const events = await db.query.watchEvents.findMany({
        where: eq(watchEvents.watchId, watch.id),
        orderBy: [desc(watchEvents.createdAt)],
        limit: 50,
        with: { deliveries: true },
      })
      return { watch: toWatchDto(watch), events: events.map(toEventDto) }
    },
  )

export const createWatch = createServerFn({ method: 'POST' })
  .inputValidator((v) => CreateWatchInput.parse(v))
  .handler(async ({ data }): Promise<WatchDto> => {
    const session = await requireSession()
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
    try {
      snapshot = await buildParcelSnapshot(isknId, now)
    } catch {
      // Watch can still be created; first cron/refresh will fill snapshot.
    }

    const [row] = await db
      .insert(parcelWatches)
      .values({
        userId: session.user.id,
        label: data.label,
        kuCode: data.kuCode,
        kuName: data.kuName,
        parcelNumber: data.parcelNumber,
        parcelSubdivision: data.parcelSubdivision ?? null,
        druhCislovani: data.druhCislovani,
        isknId,
        pollIntervalMinutes: data.pollIntervalMinutes,
        lastCheckedAt: snapshot ? now : null,
        lastSnapshotJson: snapshot,
      })
      .returning()

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

      const result = await pollWatchById(existing.id)
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
