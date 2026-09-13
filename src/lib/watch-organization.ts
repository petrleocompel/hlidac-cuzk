import { z } from 'zod'
import { parseWatchSnapshot, snapshotLv } from './cuzk/object-snapshot'

export function searchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('cs')
    .trim()
}
export const WatchTags = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((tag) => !tag.includes(','), 'Štítek nesmí obsahovat čárku.'),
  )
  .max(20)
  .transform((tags) => {
    const seen = new Set<string>()
    return tags.filter((tag) => {
      const key = searchText(tag)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })
export const OrganizationInput = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(200),
  notes: z.string().max(5000),
  tags: WatchTags,
})
export const BulkWatchInput = z
  .object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)]),
    enabled: z.boolean().optional(),
    pollIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined || value.pollIntervalMinutes !== undefined,
    'Vyberte změnu.',
  )

export type WatchFilters = {
  query: string
  ku: string
  lv: string
  status: 'all' | 'active' | 'paused' | 'error' | 'plomba'
  tag: string
}
export const EMPTY_WATCH_FILTERS: WatchFilters = {
  query: '',
  ku: '',
  lv: '',
  status: 'all',
  tag: '',
}
export type FilterableWatch = {
  label: string
  notes: string
  tags: string[]
  kuCode: string | null
  kuName: string | null
  isknId: string
  objectSummary: string | null
  parcelNumber?: number | null
  parcelSubdivision?: number | null
  enabled: boolean
  lastError: string | null
  lastSnapshotJson: unknown
}
/** Runs only on the owner's DTOs; no external call or inferred LV membership. */
export function matchesWatch(
  watch: FilterableWatch,
  filters: WatchFilters,
): boolean {
  const snapshot = parseWatchSnapshot(watch.lastSnapshotJson)
  const lv = snapshotLv(snapshot)
  if (filters.ku && watch.kuCode !== filters.ku) return false
  if (filters.lv && String(lv?.cislo ?? '') !== filters.lv.trim()) return false
  if (
    filters.tag &&
    !watch.tags.some((tag) => searchText(tag) === searchText(filters.tag))
  )
    return false
  if (
    (filters.status === 'active' && !watch.enabled) ||
    (filters.status === 'paused' && watch.enabled) ||
    (filters.status === 'error' && !watch.lastError) ||
    (filters.status === 'plomba' && !snapshot?.rizeni.length)
  )
    return false
  const text = searchText(
    [
      watch.label,
      watch.notes,
      ...watch.tags,
      watch.kuName,
      watch.kuCode,
      watch.isknId,
      watch.objectSummary,
      watch.parcelNumber != null
        ? `${watch.parcelNumber}${watch.parcelSubdivision != null ? '/' + watch.parcelSubdivision : ''}`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
  return searchText(filters.query)
    .split(/\s+/)
    .every((word) => text.includes(word))
}
