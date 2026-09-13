export type TypParcely = 'PKN' | 'PZE'
/** 1 = stavební, 2 = pozemková */
export type DruhCislovaniParcely = 1 | 2

/** TypyRizeni code list from the ČÚZK OpenAPI contract. */
export const TYPY_RIZENI = ['V', 'Z', 'PGP', 'PD', 'ZPV'] as const
export type TypRizeni = (typeof TYPY_RIZENI)[number]

export type RizeniDef = {
  id?: number
  poradoveCislo?: number
  rok?: number
  typRizeni?: string | { kod?: string; nazev?: string }
  kodPracoviste?: number
  datumPrijeti?: string
  stav?: string | null
  stavUhrady?: string | null
  provedeneOperace?: Array<{ nazev?: string; datumProvedeni?: string }> | null
  navazanaRizeni?: RizeniDef[] | null
  poznamky?: string[] | null
  [key: string]: unknown
}

export type KatastralniUzemi = {
  kod: number
  nazev: string
  kodObce?: number
  platnostDo?: string | null
}

export type LvDef = {
  id?: number
  cislo?: number
  katastralniUzemi?: { kod?: number; nazev?: string }
}

export type Parcela = {
  id?: number
  typParcely?: TypParcely
  druhCislovaniParcely?: number | string
  kmenoveCisloParcely?: number
  poddeleniCislaParcely?: number | null
  katastralniUzemi?: { kod?: number; nazev?: string }
  lv?: LvDef | null
  vymera?: number
  mapovyList?: { kod?: number; oznaceni?: string } | null
  zpusobUrceniVymery?: unknown
  druhPozemku?: unknown
  zpusobVyuziti?: unknown
  zpusobyOchrany?: unknown[] | null
  bpej?: unknown[] | null
  definicniBod?: { id?: number; x?: number; y?: number } | null
  stavba?: { id?: number } | null
  pravoStavby?: { id?: number } | null
  rizeniPlomby?: RizeniDef[] | null
  [key: string]: unknown
}

/** Typy staveb povolené ve vyhledávání: 1 = číslo popisné, 2 = číslo evidenční. */
export const TYPY_STAVBY_QUERY = [1, 2] as const
export type TypStavbyQuery = (typeof TYPY_STAVBY_QUERY)[number]

export type Stavba = {
  id?: number
  typStavby?: { kod?: number; nazev?: string } | null
  cislaDomovni?: number[] | null
  castObce?: { kod?: number; nazev?: string } | null
  obec?: { kod?: number; nazev?: string } | null
  docasna?: boolean
  typyVazby?: string | null
  lv?: LvDef | null
  pravoStavby?: { id?: number; datumUkonceni?: string | null } | null
  definicniBod?: { id?: number; x?: number; y?: number } | null
  jednotky?: Array<{ id?: number; cisloJednotky?: number }> | null
  zpusobVyuziti?: unknown
  zpusobyOchrany?: unknown[] | null
  parcely?: Array<Partial<Parcela>> | null
  /** RÚIAN codes of address places; never a KN identifier. */
  adresniMista?: number[] | null
  rizeniPlomby?: RizeniDef[] | null
  [key: string]: unknown
}

export type Jednotka = {
  id?: number
  cisloJednotky?: number
  typJednotky?: { kod?: number; nazev?: string } | null
  zpusobVyuziti?: unknown
  zpusobyOchrany?: unknown[] | null
  podilNaSpolecnychCastechDomu?: {
    citatel?: number
    jmenovatel?: number
  } | null
  lv?: LvDef | null
  vymezenaVeStavbe?: {
    id?: number
    typStavby?: { kod?: number; nazev?: string }
    cislaDomovni?: number[] | null
    castObce?: { kod?: number; nazev?: string }
  } | null
  rizeniPlomby?: RizeniDef[] | null
  [key: string]: unknown
}

export type PravoStavby = {
  id?: number
  datumUkonceni?: string | null
  datumPrijeti?: string | null
  ucelyPravaStavby?: unknown[] | null
  lv?: LvDef | null
  parcely?: Array<Partial<Parcela>> | null
  stavby?: Array<Partial<Stavba>> | null
  zpusobyOchrany?: unknown[] | null
  rizeniPlomby?: RizeniDef[] | null
  [key: string]: unknown
}

export type CuzkListResponse<T> = {
  data?: T[]
  zpravy?: Array<{ kod?: number; text?: string; typZavaznosti?: string }>
  aktualnostDatK?: string
}

export type CuzkItemResponse<T> = {
  data?: T
  zpravy?: Array<{ kod?: number; text?: string; typZavaznosti?: string }>
  aktualnostDatK?: string
}

export type SearchParcelParams = {
  kodKatastralnihoUzemi: number | string
  typParcely?: TypParcely
  druhCislovaniParcely: DruhCislovaniParcely
  kmenoveCisloParcely: number
  poddeleniCislaParcely?: number | null
  puvodParcelyZE?: string
}

async function cuzkFetch<T>(
  path: string,
  query?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  // Keep DB/network code out of imports of the pure formatting helpers.
  const { requestCuzk } = await import('./http')
  return requestCuzk<T>(path, query, signal)
}

/**
 * Search parcel by natural identification.
 * Query param names match ASP.NET model binding (PascalCase).
 */
export async function searchParcel(
  params: SearchParcelParams,
): Promise<CuzkListResponse<Parcela>> {
  const query: Record<string, string> = {
    KodKatastralnihoUzemi: String(params.kodKatastralnihoUzemi),
    TypParcely: params.typParcely ?? 'PKN',
    DruhCislovaniParcely: String(params.druhCislovaniParcely),
    KmenoveCisloParcely: String(params.kmenoveCisloParcely),
  }
  if (
    params.poddeleniCislaParcely !== undefined &&
    params.poddeleniCislaParcely !== null
  ) {
    query.PoddeleniCislaParcely = String(params.poddeleniCislaParcely)
  }
  if (params.puvodParcelyZE) {
    query.PuvodParcelyZE = params.puvodParcelyZE
  }
  return cuzkFetch('/api/v1/Parcely/Vyhledani', query)
}

export async function getParcelById(
  id: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<Parcela>> {
  return cuzkFetch(`/api/v1/Parcely/${id}`, undefined, signal)
}

export type SearchRizeniParams = {
  typRizeni: TypRizeni
  cislo: number
  rok: number
  kodPracoviste: number
}

/** All four parameters are required by the API; a miss returns an empty list. */
export async function searchRizeni(
  params: SearchRizeniParams,
  signal?: AbortSignal,
): Promise<CuzkListResponse<RizeniDef>> {
  return cuzkFetch(
    '/api/v1/Rizeni/Vyhledani',
    {
      TypRizeni: params.typRizeni,
      Cislo: String(params.cislo),
      Rok: String(params.rok),
      KodPracoviste: String(params.kodPracoviste),
    },
    signal,
  )
}

export async function getRizeniById(
  id: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<RizeniDef>> {
  return cuzkFetch(`/api/v1/Rizeni/${id}`, undefined, signal)
}

export async function getStavbaById(
  id: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<Stavba>> {
  return cuzkFetch(`/api/v1/Stavby/${id}`, undefined, signal)
}

export async function getJednotkaById(
  id: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<Jednotka>> {
  return cuzkFetch(`/api/v1/Jednotky/${id}`, undefined, signal)
}

export async function getPravoStavbyById(
  id: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<PravoStavby>> {
  return cuzkFetch(`/api/v1/PravaStavby/${id}`, undefined, signal)
}

/**
 * Verified link from RÚIAN to KN: the parameter is a RÚIAN address place code,
 * the answer is a KN building. The two code spaces are never interchanged.
 */
export async function getStavbaByAdresniMisto(
  kodAdresnihoMista: number | string,
  signal?: AbortSignal,
): Promise<CuzkItemResponse<Stavba>> {
  return cuzkFetch(
    `/api/v1/Stavby/AdresniMisto/${kodAdresnihoMista}`,
    undefined,
    signal,
  )
}

export type SearchStavbaParams = {
  /** RÚIAN code of the část obce, not a katastrální území code. */
  kodCastiObce: number
  typStavby: TypStavbyQuery
  cisloDomovni: number
}

export async function searchStavba(
  params: SearchStavbaParams,
  signal?: AbortSignal,
): Promise<CuzkListResponse<Stavba>> {
  return cuzkFetch(
    '/api/v1/Stavby/Vyhledani',
    {
      KodCastiObce: String(params.kodCastiObce),
      TypStavby: String(params.typStavby),
      CisloDomovni: String(params.cisloDomovni),
    },
    signal,
  )
}

export type SearchJednotkaParams = SearchStavbaParams & {
  cisloJednotky: number
}

export async function searchJednotka(
  params: SearchJednotkaParams,
  signal?: AbortSignal,
): Promise<CuzkListResponse<Jednotka>> {
  return cuzkFetch(
    '/api/v1/Jednotky/Vyhledani',
    {
      KodCastiObce: String(params.kodCastiObce),
      TypStavby: String(params.typStavby),
      CisloDomovni: String(params.cisloDomovni),
      CisloJednotky: String(params.cisloJednotky),
    },
    signal,
  )
}

export type CastObce = {
  kod: number
  nazev: string
  kodObce?: number
  nazevObce?: string
}

let castiObciCache: CastObce[] | null = null
let castiObciCacheAt = 0

/** RÚIAN parts of municipalities; one cached call serves the autocomplete. */
export async function listCastiObci(): Promise<CastObce[]> {
  const now = Date.now()
  if (castiObciCache && now - castiObciCacheAt < KU_CACHE_TTL_MS)
    return castiObciCache
  const result = await cuzkFetch<CuzkListResponse<CastObce>>(
    '/api/v1/CiselnikyUzemnichJednotek/CastiObci',
  )
  castiObciCache = result.data ?? []
  castiObciCacheAt = now
  return castiObciCache
}

export async function searchCastObce(query: string): Promise<CastObce[]> {
  const { filterByNameOrCode } = await import('./parcel-input')
  if (query.trim().length < 2) return []
  return filterByNameOrCode(await listCastiObci(), query)
}

let kuCache: KatastralniUzemi[] | null = null
let kuCacheAt = 0
const KU_CACHE_TTL_MS = 24 * 60 * 60_000

export async function listKatastralniUzemi(): Promise<KatastralniUzemi[]> {
  const now = Date.now()
  if (kuCache && now - kuCacheAt < KU_CACHE_TTL_MS) return kuCache
  const result = await cuzkFetch<CuzkListResponse<KatastralniUzemi>>(
    '/api/v1/CiselnikyUzemnichJednotek/KatastralniUzemi',
  )
  kuCache = result.data ?? []
  kuCacheAt = now
  return kuCache
}

/** Matches the name without diacritics or the code; max 20 hits. */
export async function searchKatastralniUzemi(
  query: string,
): Promise<KatastralniUzemi[]> {
  const { filterKatastralniUzemi } = await import('./parcel-input')
  if (query.trim().length < 2) return []
  return filterKatastralniUzemi(await listKatastralniUzemi(), query)
}

/** Resolve a unique ISKN id from search params; throws if 0 or >1 matches. */
export async function resolveIsknId(
  params: SearchParcelParams,
): Promise<{ isknId: string; parcel: Parcela }> {
  const result = await searchParcel(params)
  const rows = result.data ?? []
  if (rows.length === 0) {
    const msg = result.zpravy
      ?.map((z) => z.text)
      .filter(Boolean)
      .join('; ')
    throw new Error(msg || 'Parcela nenalezena')
  }
  if (rows.length > 1) {
    throw new Error(
      `Nalezeno ${rows.length} parcel — upřesněte druh číslování nebo poddělení`,
    )
  }
  const parcel = rows[0]
  if (parcel.id == null) throw new Error('Parcela bez ISKN id')
  return { isknId: String(parcel.id), parcel }
}

export function snapshotRizeniPlomby(parcel: Parcela): RizeniDef[] {
  return Array.isArray(parcel.rizeniPlomby) ? parcel.rizeniPlomby : []
}

export function rizeniFingerprint(items: RizeniDef[]): string {
  const ids = items
    .map((r) => String(r.id ?? `${r.poradoveCislo ?? '?'}-${r.rok ?? '?'}`))
    .sort()
  return JSON.stringify(ids)
}

export function formatRizeniLabel(r: RizeniDef): string {
  const cislo = r.poradoveCislo ?? '?'
  const rok = r.rok ?? '?'
  const typ =
    typeof r.typRizeni === 'string'
      ? r.typRizeni
      : (r.typRizeni?.kod ?? r.typRizeni?.nazev ?? '')
  return typ ? `${typ} ${cislo}/${rok}` : `${cislo}/${rok}`
}

/** Basic definitions only; neighbors do not include parcel geometry or full detail. */
export async function getNeighborParcels(
  id: string,
): Promise<CuzkListResponse<Parcela>> {
  if (!/^[1-9]\d{0,27}$/.test(id))
    throw new Error('Neplatný identifikátor parcely.')
  return cuzkFetch(`/api/v1/Parcely/SousedniParcely/${id}`)
}
