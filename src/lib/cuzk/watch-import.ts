import { parseCsv } from '#/lib/csv'
import { DEFAULT_POLL_MINUTES } from './policy'
import { formatParcelNumberInput, parseParcelNumber } from './parcel-input'

export const IMPORT_ROW_LIMIT = 200

export type ImportFormat = 'csv' | 'json'

export type ImportCandidate = {
  label: string
  kuCode: string
  kmenoveCisloParcely: number
  poddeleniCislaParcely: number | null
  druhCislovani: 1 | 2
  pollIntervalMinutes: number
}

export type ImportRowStatus =
  'ok' | 'invalid' | 'duplicate' | 'duplicate_in_file'

export type ImportRow = {
  /** 1-based position in the file, so the user can find the line. */
  line: number
  raw: string
  status: ImportRowStatus
  message?: string
  candidate?: ImportCandidate
}

export type ImportPlan = {
  rows: ImportRow[]
  ready: number
  skipped: number
  /** One ČÚZK search per ready row; the snapshot is taken by the next check. */
  apiCalls: number
}

const HEADER_ALIASES: Record<string, keyof RawRow> = {
  nazev: 'label',
  název: 'label',
  label: 'label',
  ku_kod: 'kuCode',
  kukod: 'kuCode',
  kod_ku: 'kuCode',
  kucode: 'kuCode',
  ku: 'kuCode',
  katastralni_uzemi_kod: 'kuCode',
  parcela: 'parcel',
  parcel: 'parcel',
  parcelni_cislo: 'parcel',
  parcelní_číslo: 'parcel',
  interval: 'interval',
  interval_minut: 'interval',
  pollintervalminutes: 'interval',
}

type RawRow = {
  label?: string
  kuCode?: string
  parcel?: string
  interval?: string
}

function normalizeHeader(value: string): keyof RawRow | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_á-ž]/giu, '')
  return HEADER_ALIASES[key] ?? null
}

function rawFromObject(value: Record<string, unknown>): RawRow {
  const row: RawRow = {}
  for (const [key, entry] of Object.entries(value)) {
    const field = normalizeHeader(key)
    if (field && entry != null) row[field] = String(entry)
  }
  return row
}

function describe(raw: RawRow): string {
  return [raw.label, raw.kuCode, raw.parcel, raw.interval]
    .filter((value) => value != null && value !== '')
    .join(' · ')
}

function toCandidate(raw: RawRow): ImportCandidate {
  const kuCode = (raw.kuCode ?? '').trim()
  if (!/^\d{1,20}$/.test(kuCode))
    throw new Error('Kód katastrálního území musí být číslo, například 777552.')
  const parcel = parseParcelNumber(raw.parcel ?? '')
  const interval =
    raw.interval && raw.interval.trim() !== ''
      ? Number(raw.interval.trim())
      : DEFAULT_POLL_MINUTES
  if (!Number.isInteger(interval) || interval < 5 || interval > 1440)
    throw new Error('Interval musí být celé číslo 5–1440 minut.')
  const label = (raw.label ?? '').trim()
  return {
    label: label || `${kuCode} ${formatParcelNumberInput(parcel)}`,
    kuCode,
    kmenoveCisloParcely: parcel.kmenoveCisloParcely,
    poddeleniCislaParcely: parcel.poddeleniCislaParcely,
    druhCislovani: parcel.druhCislovani,
    pollIntervalMinutes: interval,
  }
}

export function parseImportRows(
  content: string,
  format: ImportFormat,
): { raw: RawRow[]; error?: string } {
  if (format === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return { raw: [], error: 'Soubor není platný JSON.' }
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { watches?: unknown }).watches)
        ? (parsed as { watches: unknown[] }).watches
        : null
    if (!list)
      return {
        raw: [],
        error: 'JSON musí být seznam položek, nebo objekt s polem „watches“.',
      }
    return {
      raw: list.map((item) =>
        item && typeof item === 'object'
          ? rawFromObject(item as Record<string, unknown>)
          : {},
      ),
    }
  }
  const rows = parseCsv(content)
  if (!rows.length) return { raw: [], error: 'Soubor neobsahuje žádné řádky.' }
  const header = rows[0].map(normalizeHeader)
  if (!header.includes('kuCode') || !header.includes('parcel'))
    return {
      raw: [],
      error:
        'Chybí záhlaví se sloupci ku_kod a parcela (volitelně nazev a interval).',
    }
  return {
    raw: rows.slice(1).map((cells) => {
      const row: RawRow = {}
      header.forEach((field, index) => {
        if (field && cells[index]) row[field] = cells[index]
      })
      return row
    }),
  }
}

/** Parcel identification of an existing watch; other registers have none. */
export type ExistingWatchKey = {
  kuCode: string | null
  parcelNumber: number | null
  parcelSubdivision: number | null
  druhCislovani: number
}

function keyOf(value: ExistingWatchKey): string | null {
  if (!value.kuCode || value.parcelNumber == null) return null
  return [
    value.kuCode,
    value.parcelNumber,
    value.parcelSubdivision ?? '',
    value.druhCislovani,
  ].join('|')
}

/**
 * Validates every row on its own, so one bad line never discards the valid ones.
 * Duplicates are detected against existing watches and within the file itself.
 */
export function planWatchImport(
  content: string,
  format: ImportFormat,
  existing: ExistingWatchKey[],
): ImportPlan & { error?: string } {
  const parsed = parseImportRows(content, format)
  if (parsed.error)
    return { rows: [], ready: 0, skipped: 0, apiCalls: 0, error: parsed.error }
  const known = new Set(
    existing.map(keyOf).filter((key): key is string => key !== null),
  )
  const seen = new Set<string>()
  const rows: ImportRow[] = []
  for (const [index, raw] of parsed.raw.entries()) {
    const line = index + 1
    if (rows.length >= IMPORT_ROW_LIMIT) {
      rows.push({
        line,
        raw: describe(raw),
        status: 'invalid',
        message: `Najednou lze importovat nejvýše ${IMPORT_ROW_LIMIT} řádků.`,
      })
      continue
    }
    let candidate: ImportCandidate
    try {
      candidate = toCandidate(raw)
    } catch (error) {
      rows.push({
        line,
        raw: describe(raw),
        status: 'invalid',
        message: error instanceof Error ? error.message : 'Neplatný řádek.',
      })
      continue
    }
    const key = keyOf({
      kuCode: candidate.kuCode,
      parcelNumber: candidate.kmenoveCisloParcely,
      parcelSubdivision: candidate.poddeleniCislaParcely,
      druhCislovani: candidate.druhCislovani,
    })!
    if (known.has(key)) {
      rows.push({
        line,
        raw: describe(raw),
        status: 'duplicate',
        message: 'Toto sledování už máte; řádek se přeskočí.',
        candidate,
      })
      continue
    }
    if (seen.has(key)) {
      rows.push({
        line,
        raw: describe(raw),
        status: 'duplicate_in_file',
        message:
          'Stejná parcela je v souboru vícekrát; použije se první výskyt.',
        candidate,
      })
      continue
    }
    seen.add(key)
    rows.push({ line, raw: describe(raw), status: 'ok', candidate })
  }
  const ready = rows.filter((row) => row.status === 'ok').length
  return {
    rows,
    ready,
    skipped: rows.length - ready,
    apiCalls: ready,
  }
}
