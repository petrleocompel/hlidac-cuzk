import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import type { ParcelWatch } from '#/db/schema'
import { resolveIsknId } from './client'
import type { Parcela } from './client'
import { buildParcelSnapshot } from './snapshot'
import type { ParcelSnapshot } from './snapshot'
import { CuzkUnavailableError } from './policy'
import { insertWatchWithinLimit } from './watch-limits'
import type { ImportPlan, ImportRow } from './watch-import'

/** Identification taken from a verified ČÚZK answer, never from user input. */
export type VerifiedParcel = {
  isknId: string
  kuCode: string
  kuName: string
  parcelNumber: number
  parcelSubdivision: number | null
  druhCislovani: number
  typParcely: string | null
  vymera: number | null
  druhPozemku: string | null
  lvCislo: number | null
  plomby: number | null
}

function requireIdentification(value: {
  isknId: string | null
  kuCode: string | null
  kuName: string | null
  parcelNumber: number | null
}): void {
  if (!value.isknId || !value.kuCode || !value.kuName || !value.parcelNumber)
    throw new Error(
      'ČÚZK nevrátilo úplnou identifikaci parcely. Zkuste to prosím znovu.',
    )
}

export function verifiedFromParcela(parcel: Parcela): VerifiedParcel {
  const value = {
    isknId: parcel.id != null ? String(parcel.id) : null,
    kuCode: parcel.katastralniUzemi?.kod != null
      ? String(parcel.katastralniUzemi.kod)
      : null,
    kuName: parcel.katastralniUzemi?.nazev ?? null,
    parcelNumber: parcel.kmenoveCisloParcely ?? null,
  }
  requireIdentification(value)
  return {
    isknId: value.isknId!,
    kuCode: value.kuCode!,
    kuName: value.kuName!,
    parcelNumber: value.parcelNumber!,
    parcelSubdivision: parcel.poddeleniCislaParcely ?? null,
    druhCislovani: Number(parcel.druhCislovaniParcely) || 2,
    typParcely: parcel.typParcely ?? null,
    vymera: typeof parcel.vymera === 'number' ? parcel.vymera : null,
    druhPozemku:
      typeof parcel.druhPozemku === 'object' && parcel.druhPozemku
        ? ((parcel.druhPozemku as { nazev?: string }).nazev ?? null)
        : typeof parcel.druhPozemku === 'string'
          ? parcel.druhPozemku
          : null,
    lvCislo: parcel.lv?.cislo ?? null,
    plomby: Array.isArray(parcel.rizeniPlomby)
      ? parcel.rizeniPlomby.length
      : null,
  }
}

export function verifiedFromSnapshot(snapshot: ParcelSnapshot): VerifiedParcel {
  const parcel = snapshot.parcel
  const value = {
    isknId: parcel.id || null,
    kuCode: parcel.kuKod != null ? String(parcel.kuKod) : null,
    kuName: parcel.kuNazev,
    parcelNumber: parcel.kmenoveCisloParcely,
  }
  requireIdentification(value)
  return {
    isknId: value.isknId!,
    kuCode: value.kuCode!,
    kuName: value.kuName!,
    parcelNumber: value.parcelNumber!,
    parcelSubdivision: parcel.poddeleniCislaParcely,
    druhCislovani: parcel.druhCislovaniParcely ?? 2,
    typParcely: parcel.typParcely,
    vymera: parcel.vymera,
    druhPozemku: parcel.druhPozemku,
    lvCislo: parcel.lv?.cislo ?? null,
    plomby: snapshot.rizeni.length,
  }
}

export type ParcelLookup = VerifiedParcel & { alreadyWatchedId: string | null }

/** One ČÚZK search; the result is what the user confirms before saving. */
export async function lookupParcelForWatch(
  userId: string,
  params: {
    kuCode: string
    kmenoveCisloParcely: number
    poddeleniCislaParcely: number | null
    druhCislovani: 1 | 2
  },
): Promise<ParcelLookup> {
  const { parcel } = await resolveIsknId({
    kodKatastralnihoUzemi: params.kuCode,
    typParcely: 'PKN',
    druhCislovaniParcely: params.druhCislovani,
    kmenoveCisloParcely: params.kmenoveCisloParcely,
    poddeleniCislaParcely: params.poddeleniCislaParcely,
  })
  const verified = verifiedFromParcela(parcel)
  const existing = await db.query.parcelWatches.findFirst({
    where: and(
      eq(parcelWatches.userId, userId),
      eq(parcelWatches.isknId, verified.isknId),
    ),
    columns: { id: true },
  })
  return { ...verified, alreadyWatchedId: existing?.id ?? null }
}

/**
 * Creates a watch from a ČÚZK-verified ISKN id. The first snapshot is part of
 * the verification, so a watch is never stored for an unconfirmed parcel.
 */
export async function createVerifiedWatch(input: {
  userId: string
  isknId: string
  label?: string
  pollIntervalMinutes: number
  now?: Date
}): Promise<ParcelWatch> {
  const now = input.now ?? new Date()
  const snapshot = await buildParcelSnapshot(input.isknId, now)
  const verified = verifiedFromSnapshot(snapshot)
  return insertWatchWithinLimit({
    userId: input.userId,
    label: input.label?.trim()
      ? input.label.trim()
      : `${verified.kuName} ${verified.parcelNumber}${
          verified.parcelSubdivision != null
            ? `/${verified.parcelSubdivision}`
            : ''
        }`,
    kuCode: verified.kuCode,
    kuName: verified.kuName,
    parcelNumber: verified.parcelNumber,
    parcelSubdivision: verified.parcelSubdivision,
    druhCislovani: verified.druhCislovani,
    isknId: verified.isknId,
    pollIntervalMinutes: input.pollIntervalMinutes,
    lastCheckedAt: now,
    lastAttemptAt: now,
    lastSuccessfulCheckAt: now,
    nextCheckAt: new Date(now.getTime() + input.pollIntervalMinutes * 60_000),
    lastError: null,
    lastSnapshotJson: snapshot,
  })
}

export type ImportOutcome = {
  created: Array<{ line: number; watchId: string; label: string }>
  failed: Array<{ line: number; raw: string; message: string }>
  skipped: ImportRow[]
  /** Set when ČÚZK stopped answering and the remaining rows were not tried. */
  stoppedReason?: string
}

/**
 * Imports row by row: one ČÚZK search each, no first snapshot (the next check
 * takes it). A failing row never discards the rows that worked.
 */
export async function importVerifiedWatches(
  userId: string,
  plan: ImportPlan,
  now = new Date(),
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = {
    created: [],
    failed: [],
    skipped: plan.rows.filter((row) => row.status !== 'ok'),
  }
  for (const row of plan.rows) {
    if (row.status !== 'ok' || !row.candidate) continue
    if (outcome.stoppedReason) {
      outcome.failed.push({
        line: row.line,
        raw: row.raw,
        message: 'Řádek nebyl zpracován; import se zastavil dříve.',
      })
      continue
    }
    const candidate = row.candidate
    try {
      const { parcel } = await resolveIsknId({
        kodKatastralnihoUzemi: candidate.kuCode,
        typParcely: 'PKN',
        druhCislovaniParcely: candidate.druhCislovani,
        kmenoveCisloParcely: candidate.kmenoveCisloParcely,
        poddeleniCislaParcely: candidate.poddeleniCislaParcely,
      })
      const verified = verifiedFromParcela(parcel)
      const watch = await insertWatchWithinLimit({
        userId,
        label: candidate.label,
        kuCode: verified.kuCode,
        kuName: verified.kuName,
        parcelNumber: verified.parcelNumber,
        parcelSubdivision: verified.parcelSubdivision,
        druhCislovani: verified.druhCislovani,
        isknId: verified.isknId,
        pollIntervalMinutes: candidate.pollIntervalMinutes,
        lastAttemptAt: null,
        // The worker takes the first snapshot; the import only verifies identity.
        nextCheckAt: now,
      })
      outcome.created.push({
        line: row.line,
        watchId: watch.id,
        label: watch.label,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Řádek se nepodařilo uložit.'
      outcome.failed.push({ line: row.line, raw: row.raw, message })
      if (error instanceof CuzkUnavailableError) outcome.stoppedReason = message
    }
  }
  return outcome
}
