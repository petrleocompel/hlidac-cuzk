import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import type { ParcelWatch } from '#/db/schema'
import { resolveIsknId, searchJednotka, searchStavba } from './client'
import type { Parcela, TypStavbyQuery } from './client'
import { buildParcelSnapshot, formatParcelAttrValue } from './snapshot'
import type { ParcelSnapshot } from './snapshot'
import {
  buildObjectSnapshot,
  objectAttrDefs,
  objectTypeLabel,
} from './object-snapshot'
import type { ObjectSnapshot, ObjectType } from './object-snapshot'
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
    kuCode:
      parcel.katastralniUzemi?.kod != null
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

/** Same object watched twice is refused per register, not across registers. */
async function existingWatchId(
  userId: string,
  objectType: ObjectType,
  isknId: string,
): Promise<string | null> {
  const existing = await db.query.parcelWatches.findFirst({
    where: and(
      eq(parcelWatches.userId, userId),
      eq(parcelWatches.objectType, objectType),
      eq(parcelWatches.isknId, isknId),
    ),
    columns: { id: true },
  })
  return existing?.id ?? null
}

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
  return {
    ...verified,
    alreadyWatchedId: await existingWatchId(userId, 'parcel', verified.isknId),
  }
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
    objectType: 'parcel',
    objectSummary: `${verified.kuName} ${verified.parcelNumber}${
      verified.parcelSubdivision != null ? `/${verified.parcelSubdivision}` : ''
    }`,
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

export type ObjectLookup = {
  objectType: Exclude<ObjectType, 'parcel'>
  isknId: string
  summary: string
  kuCode: string | null
  kuName: string | null
  lvCislo: number | null
  plomby: number
  attrs: Array<{ field: string; label: string; value: string }>
  alreadyWatchedId: string | null
}

function describeAttrs(snapshot: ObjectSnapshot): ObjectLookup['attrs'] {
  return objectAttrDefs(snapshot.objectType).map((def) => ({
    field: def.field,
    label: def.label,
    value: formatParcelAttrValue(
      def.field,
      snapshot.object.attrs[def.field] ?? null,
    ),
  }))
}

function lookupFromSnapshot(
  snapshot: ObjectSnapshot,
  alreadyWatchedId: string | null,
): ObjectLookup {
  return {
    objectType: snapshot.objectType,
    isknId: snapshot.object.id,
    summary: snapshot.object.summary,
    kuCode:
      snapshot.object.kuKod != null ? String(snapshot.object.kuKod) : null,
    kuName: snapshot.object.kuNazev,
    lvCislo: snapshot.object.lv?.cislo ?? null,
    plomby: snapshot.rizeni.length,
    attrs: describeAttrs(snapshot),
    alreadyWatchedId,
  }
}

/**
 * Verifies a building, unit or right of superficies by its ISKN id. The answer
 * is what the user confirms; nothing is derived from the entered numbers.
 */
export async function lookupObjectForWatch(
  userId: string,
  objectType: Exclude<ObjectType, 'parcel'>,
  isknId: string,
  now = new Date(),
): Promise<ObjectLookup> {
  const snapshot = await buildObjectSnapshot(objectType, isknId, now)
  return lookupFromSnapshot(
    snapshot,
    await existingWatchId(userId, objectType, snapshot.object.id),
  )
}

/** Searches a building or unit by RÚIAN část obce, house number and unit. */
export async function lookupBuildingOrUnit(
  userId: string,
  params: {
    objectType: 'stavba' | 'jednotka'
    kodCastiObce: number
    typStavby: TypStavbyQuery
    cisloDomovni: number
    cisloJednotky?: number | null
  },
  now = new Date(),
): Promise<ObjectLookup> {
  const response =
    params.objectType === 'stavba'
      ? await searchStavba({
          kodCastiObce: params.kodCastiObce,
          typStavby: params.typStavby,
          cisloDomovni: params.cisloDomovni,
        })
      : await searchJednotka({
          kodCastiObce: params.kodCastiObce,
          typStavby: params.typStavby,
          cisloDomovni: params.cisloDomovni,
          cisloJednotky: params.cisloJednotky ?? 0,
        })
  const rows = response.data ?? []
  if (!rows.length) {
    const message = response.zpravy
      ?.map((zprava) => zprava.text)
      .filter(Boolean)
      .join('; ')
    throw new Error(
      message ||
        'Objekt nebyl nalezen. Zkontrolujte část obce, typ a čísla podle ČÚZK.',
    )
  }
  const hit = rows.find((row) => row.id != null)
  if (!hit?.id)
    throw new Error('ČÚZK vrátilo objekt bez ISKN id; sledovat jej nelze.')
  // Search answers are shortened; the detail is the verified source of truth.
  return lookupObjectForWatch(userId, params.objectType, String(hit.id), now)
}

/** Creates a watch of a building, unit or right of superficies. */
export async function createVerifiedObjectWatch(input: {
  userId: string
  objectType: Exclude<ObjectType, 'parcel'>
  isknId: string
  label?: string
  pollIntervalMinutes: number
  now?: Date
}): Promise<ParcelWatch> {
  const now = input.now ?? new Date()
  const snapshot = await buildObjectSnapshot(
    input.objectType,
    input.isknId,
    now,
  )
  if (!snapshot.object.id)
    throw new Error('ČÚZK nevrátilo identifikaci objektu. Zkuste to znovu.')
  const kuKod = snapshot.object.kuKod
  return insertWatchWithinLimit({
    userId: input.userId,
    objectType: input.objectType,
    objectSummary: snapshot.object.summary,
    label: input.label?.trim()
      ? input.label.trim()
      : `${objectTypeLabel(input.objectType)} ${snapshot.object.summary}`,
    // Only what the register really provides; parcel numbers stay empty.
    kuCode: kuKod != null ? String(kuKod) : null,
    kuName: snapshot.object.kuNazev,
    parcelNumber: null,
    parcelSubdivision: null,
    isknId: snapshot.object.id,
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
