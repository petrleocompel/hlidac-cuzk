import { and, asc, eq } from 'drizzle-orm'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { parcelWatches, watchRizeni } from '#/db/schema'
import type { WatchRizeni } from '#/db/schema'
import { TYPY_RIZENI, getRizeniById, searchRizeni } from '#/lib/cuzk/client'
import { normalizeRizeni, parseRizeniSnapshot } from '#/lib/cuzk/snapshot'
import type { RizeniSnapshot } from '#/lib/cuzk/snapshot'
import {
  followKnownRizeni,
  stopFollowingRizeni,
} from '#/lib/cuzk/rizeni-tracking'
import type { FollowEndReason } from '#/lib/cuzk/rizeni-follow'

export type TrackedRizeniDto = {
  id: string
  rizeniId: string
  source: 'plomba' | 'manual'
  isPlomba: boolean
  typRizeni: string | null
  poradoveCislo: number | null
  rok: number | null
  kodPracoviste: number | null
  firstSeenAt: string
  detachedAt: string | null
  followUntil: string | null
  followEndedAt: string | null
  followEndedReason: FollowEndReason | null
  detail: RizeniSnapshot | null
  detailFetchedAt: string | null
  lastError: string | null
}

export function toTrackedRizeniDto(row: WatchRizeni): TrackedRizeniDto {
  return {
    id: row.id,
    rizeniId: row.rizeniId,
    source: row.source,
    isPlomba: row.isPlomba,
    typRizeni: row.typRizeni,
    poradoveCislo: row.poradoveCislo,
    rok: row.rok,
    kodPracoviste: row.kodPracoviste,
    firstSeenAt: row.firstSeenAt.toISOString(),
    detachedAt: row.detachedAt?.toISOString() ?? null,
    followUntil: row.followUntil?.toISOString() ?? null,
    followEndedAt: row.followEndedAt?.toISOString() ?? null,
    followEndedReason: row.followEndedReason,
    detail: parseRizeniSnapshot(row.detailJson),
    detailFetchedAt: row.detailFetchedAt?.toISOString() ?? null,
    lastError: row.lastError,
  }
}

/** Plomby first, then the most recently detached follows. */
export async function listTrackedRizeni(
  watchId: string,
): Promise<TrackedRizeniDto[]> {
  const rows = await db
    .select()
    .from(watchRizeni)
    .where(eq(watchRizeni.watchId, watchId))
    .orderBy(asc(watchRizeni.firstSeenAt))
  return rows
    .map(toTrackedRizeniDto)
    .sort((a, b) =>
      a.isPlomba === b.isPlomba
        ? (b.detachedAt ?? b.firstSeenAt).localeCompare(
            a.detachedAt ?? a.firstSeenAt,
          )
        : a.isPlomba
          ? -1
          : 1,
    )
}

const FollowInput = z
  .object({
    watchId: z.string().uuid(),
    /** ISKN id, e.g. from navazanaRizeni. */
    rizeniId: z
      .string()
      .regex(/^[1-9]\d{0,27}$/)
      .optional(),
    typRizeni: z.enum(TYPY_RIZENI).optional(),
    cislo: z.coerce.number().int().min(1).max(99_999_999).optional(),
    rok: z.coerce.number().int().min(2003).max(2099).optional(),
    kodPracoviste: z.coerce.number().int().min(1).max(999).optional(),
  })
  .refine(
    (value) =>
      value.rizeniId != null ||
      (value.typRizeni != null &&
        value.cislo != null &&
        value.rok != null &&
        value.kodPracoviste != null),
    'Zadejte ISKN id řízení, nebo typ, číslo, rok a kód pracoviště.',
  )

async function requireOwnedWatch(watchId: string, userId: string) {
  const watch = await db.query.parcelWatches.findFirst({
    where: and(eq(parcelWatches.id, watchId), eq(parcelWatches.userId, userId)),
    columns: { id: true },
  })
  if (!watch) throw new Error('not_found')
  return watch
}

/** Looks the řízení up in ČÚZK before it is accepted for following. */
async function resolveRizeni(
  data: z.infer<typeof FollowInput>,
  now: Date,
): Promise<RizeniSnapshot> {
  if (data.rizeniId) {
    const response = await getRizeniById(data.rizeniId)
    if (!response.data) throw new Error('Řízení se nepodařilo najít v ČÚZK.')
    return normalizeRizeni(response.data, now)
  }
  const response = await searchRizeni({
    typRizeni: data.typRizeni!,
    cislo: data.cislo!,
    rok: data.rok!,
    kodPracoviste: data.kodPracoviste!,
  })
  const rows = response.data ?? []
  if (!rows.length) {
    const message = response.zpravy
      ?.map((zprava) => zprava.text)
      .filter(Boolean)
      .join('; ')
    throw new Error(
      message ||
        'Řízení nebylo nalezeno. Zkontrolujte číslo, rok a pracoviště.',
    )
  }
  const hit = rows.find((row) => row.id != null) ?? rows[0]
  if (hit.id == null) throw new Error('Řízení bez ISKN id nelze sledovat.')
  return normalizeRizeni(hit, now)
}

export const followRizeni = createServerFn({ method: 'POST' })
  .inputValidator((v) => FollowInput.parse(v))
  .handler(
    async ({
      data,
    }): Promise<{ rizeniId: string; alreadyTracked: boolean }> => {
      const session = await requireSession()
      // Checked before the ČÚZK call so a foreign watch never spends the budget.
      await requireOwnedWatch(data.watchId, session.user.id)
      const now = new Date()
      const detail = await resolveRizeni(data, now)
      const result = await followKnownRizeni(
        data.watchId,
        session.user.id,
        detail,
        now,
      )
      return { rizeniId: detail.id, alreadyTracked: result.alreadyTracked }
    },
  )

const UnfollowInput = z.object({ id: z.string().uuid() })

export const unfollowRizeni = createServerFn({ method: 'POST' })
  .inputValidator((v) => UnfollowInput.parse(v))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const session = await requireSession()
    await stopFollowingRizeni(data.id, session.user.id)
    return { ok: true }
  })
