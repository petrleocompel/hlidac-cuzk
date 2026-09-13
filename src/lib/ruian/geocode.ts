/**
 * RÚIAN address search (ArcGIS GeocodeSOE + the AdresniMisto layer of the same
 * MapServer). This service is public and has no ČÚZK API key, so it does not
 * spend the KN request budget; it has its own availability and its own limits.
 */
export class RuianUnavailableError extends Error {}

export type AddressSuggestion = {
  text: string
  /**
   * Internal key of the geocoder. Verified on 13 September 2026 that it is NOT
   * the RÚIAN address place code, so it is never used as an identifier.
   */
  magicKey: string
}

export type AddressPlace = {
  /** Kód adresního místa (RÚIAN). */
  kod: number
  adresa: string
  cisloDomovni: number | null
  cisloOrientacni: string | null
  psc: number | null
  /** RÚIAN building object code; not a KN identifier. */
  ruianStavebniObjekt: number | null
}

const SUGGEST_TTL_MS = 10 * 60_000
const PLACE_TTL_MS = 24 * 60 * 60_000
const TIMEOUT_MS = 10_000

type CacheEntry<T> = { at: number; value: T }
const suggestCache = new Map<string, CacheEntry<AddressSuggestion[]>>()
const placeCache = new Map<string, CacheEntry<AddressPlace[]>>()

function baseUrl(): URL {
  const value =
    process.env.RUIAN_GEOCODE_URL ??
    'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer'
  const url = new URL(value.replace(/\/$/, '') + '/')
  if (!['http:', 'https:'].includes(url.protocol))
    throw new RuianUnavailableError('RUIAN_GEOCODE_URL musí být HTTP/HTTPS.')
  return url
}

async function request<T>(
  path: string,
  query: Record<string, string>,
): Promise<T> {
  const url = new URL(path, baseUrl())
  for (const [key, value] of Object.entries({ ...query, f: 'json' }))
    url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new RuianUnavailableError(
      'Adresní službu RÚIAN se nepodařilo oslovit. Zkuste to za chvíli.',
    )
  }
  if (!response.ok)
    throw new RuianUnavailableError(
      `Adresní služba RÚIAN vrátila HTTP ${response.status}.`,
    )
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new RuianUnavailableError(
      'Adresní služba RÚIAN vrátila neplatnou odpověď.',
    )
  }
  if (data && typeof data === 'object' && 'error' in data)
    throw new RuianUnavailableError(
      'Adresní služba RÚIAN dotaz odmítla. Upravte zadání.',
    )
  return data as T
}

function cached<T>(
  store: Map<string, CacheEntry<T>>,
  key: string,
  ttl: number,
): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > ttl) {
    store.delete(key)
    return null
  }
  return entry.value
}

/** Suggests address places only; parcel definition points are not addresses. */
export async function suggestAddresses(
  query: string,
  limit = 10,
): Promise<AddressSuggestion[]> {
  const text = query.trim()
  if (text.length < 3) return []
  const key = `${text}|${limit}`
  const hit = cached(suggestCache, key, SUGGEST_TTL_MS)
  if (hit) return hit
  const data = await request<{
    suggestions?: Array<{ text?: string; magicKey?: string; type?: string }>
  }>('exts/GeocodeSOE/suggest', {
    text,
    category: 'AdresniMisto',
    maxSuggestions: String(limit),
  })
  const suggestions = (data.suggestions ?? [])
    .filter(
      (row): row is { text: string; magicKey: string; type?: string } =>
        typeof row.text === 'string' && typeof row.magicKey === 'string',
    )
    .filter((row) => !row.type || row.type === 'AdresniMisto')
    .map((row) => ({ text: row.text, magicKey: row.magicKey }))
  suggestCache.set(key, { at: Date.now(), value: suggestions })
  return suggestions
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Resolves the address place code by an exact match of the RÚIAN address text.
 * No coordinate or nearest-point fallback: an address that cannot be matched
 * exactly is reported as unresolved instead of being guessed.
 */
export async function resolveAddressPlaces(
  address: string,
): Promise<AddressPlace[]> {
  const text = address.trim()
  if (!text) return []
  const hit = cached(placeCache, text, PLACE_TTL_MS)
  if (hit) return hit
  const data = await request<{
    features?: Array<{ attributes?: Record<string, unknown> }>
  }>('1/query', {
    // Single quotes are the only escaping needed for an ArcGIS where clause.
    where: `adresa='${text.replaceAll("'", "''")}'`,
    outFields:
      'kod,adresa,cislodomovni,cisloorientacni,cisloorientacnipismeno,psc,stavebniobjekt',
    returnGeometry: 'false',
  })
  const places = (data.features ?? [])
    .map((feature) => feature.attributes ?? {})
    .filter((attrs) => asNumber(attrs.kod) != null)
    .map((attrs) => {
      const orientacni = asNumber(attrs.cisloorientacni)
      const letter =
        typeof attrs.cisloorientacnipismeno === 'string'
          ? attrs.cisloorientacnipismeno
          : ''
      return {
        kod: asNumber(attrs.kod)!,
        adresa: typeof attrs.adresa === 'string' ? attrs.adresa : text,
        cisloDomovni: asNumber(attrs.cislodomovni),
        cisloOrientacni:
          orientacni != null ? `${orientacni}${letter}` : letter || null,
        psc: asNumber(attrs.psc),
        ruianStavebniObjekt: asNumber(attrs.stavebniobjekt),
      }
    })
  placeCache.set(text, { at: Date.now(), value: places })
  return places
}

/** Only for tests and long-running workers that change the configured service. */
export function clearRuianCaches(): void {
  suggestCache.clear()
  placeCache.clear()
}
