import type { DruhCislovaniParcely, KatastralniUzemi } from './client'

export type ParsedParcelNumber = {
  kmenoveCisloParcely: number
  poddeleniCislaParcely: number | null
  /** 1 = stavební (written as `st. 25`), 2 = pozemková. */
  druhCislovani: DruhCislovaniParcely
}

/** Czech search without a diacritics-aware collation in the browser or DB. */
export function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('cs')
}

const PARCEL_PATTERN = /^(st\.?\s*)?(\d{1,8})(\s*\/\s*(\d{1,6}))?$/i

/**
 * Accepts one field as people write it: `1133/77`, `1133`, `st. 25`, `st.25/2`.
 * Throws a message meant for the user; never guesses a missing number.
 */
export function parseParcelNumber(input: string): ParsedParcelNumber {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) throw new Error('Zadejte parcelní číslo, například 1133/77.')
  const match = PARCEL_PATTERN.exec(text)
  if (!match)
    throw new Error(
      `Parcelní číslo „${input.trim()}“ nerozumím. Použijte 1133/77, 1133 nebo st. 25.`,
    )
  const kmenove = Number(match[2])
  const poddeleni = match[4] ? Number(match[4]) : null
  if (!kmenove)
    throw new Error('Kmenové číslo parcely musí být větší než nula.')
  if (poddeleni === 0)
    throw new Error('Poddělení čísla parcely nemůže být nula.')
  return {
    kmenoveCisloParcely: kmenove,
    poddeleniCislaParcely: poddeleni,
    druhCislovani: match[1] ? 1 : 2,
  }
}

export function formatParcelNumberInput(value: {
  kmenoveCisloParcely: number
  poddeleniCislaParcely: number | null
  druhCislovani?: number
}): string {
  const prefix = value.druhCislovani === 1 ? 'st. ' : ''
  return value.poddeleniCislaParcely != null
    ? `${prefix}${value.kmenoveCisloParcely}/${value.poddeleniCislaParcely}`
    : `${prefix}${value.kmenoveCisloParcely}`
}

/**
 * Matches a code list entry by name without diacritics or by code prefix. Used
 * for katastrální území (KN) and části obce (RÚIAN); the caller decides which
 * register it passes in, the two code spaces are never mixed here.
 */
export function filterByNameOrCode<T extends { kod: number; nazev: string }>(
  list: T[],
  query: string,
  limit = 20,
): T[] {
  const text = query.trim()
  if (text.length < 2) return []
  if (/^\d+$/.test(text)) {
    const exact = list.filter((entry) => String(entry.kod) === text)
    if (exact.length) return exact.slice(0, limit)
    return list
      .filter((entry) => String(entry.kod).startsWith(text))
      .slice(0, limit)
  }
  const folded = foldDiacritics(text)
  const hits = list.filter((entry) =>
    foldDiacritics(entry.nazev).includes(folded),
  )
  // Names starting with the query are the more likely intent.
  return hits
    .sort((a, b) => {
      const aStarts = foldDiacritics(a.nazev).startsWith(folded)
      const bStarts = foldDiacritics(b.nazev).startsWith(folded)
      if (aStarts !== bStarts) return aStarts ? -1 : 1
      return a.nazev.localeCompare(b.nazev, 'cs')
    })
    .slice(0, limit)
}

export function filterKatastralniUzemi(
  list: KatastralniUzemi[],
  query: string,
  limit = 20,
): KatastralniUzemi[] {
  return filterByNameOrCode(list, query, limit)
}
