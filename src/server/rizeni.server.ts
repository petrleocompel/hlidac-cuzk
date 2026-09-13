import { and, asc, eq } from 'drizzle-orm'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { parcelWatches, watchRizeni } from '#/db/schema'
import type { WatchRizeni } from '#/db/schema'
import { getRizeniById, searchRizeni } from '#/lib/cuzk/client'
import { normalizeRizeni, parseRizeniSnapshot } from '#/lib/cuzk/snapshot'
import type { RizeniSnapshot } from '#/lib/cuzk/snapshot'
import {
  followKnownRizeni,
  stopFollowingRizeni,
} from '#/lib/cuzk/rizeni-tracking'
import type { TrackedRizeniDto } from '#/lib/cuzk/rizeni-dto'
import type { FollowInputValue } from '#/lib/cuzk/rizeni-input'

export type { TrackedRizeniDto } from '#/lib/cuzk/rizeni-dto'

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
  data: FollowInputValue,
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

export async function followRizeniForUser(
  data: FollowInputValue,
): Promise<{ rizeniId: string; alreadyTracked: boolean }> {
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
}

export async function unfollowRizeniForUser(id: string): Promise<{ ok: true }> {
  const session = await requireSession()
  await stopFollowingRizeni(id, session.user.id)
  return { ok: true }
}
