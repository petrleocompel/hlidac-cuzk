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

export type Parcela = {
  id?: number
  typParcely?: TypParcely
  druhCislovaniParcely?: number | string
  kmenoveCisloParcely?: number
  poddeleniCislaParcely?: number | null
  katastralniUzemi?: { kod?: number; nazev?: string }
  lv?: {
    id?: number
    cislo?: number
    katastralniUzemi?: { kod?: number; nazev?: string }
  } | null
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

/** Case-insensitive substring match on KU name; max 20 hits. */
export async function searchKatastralniUzemi(
  query: string,
): Promise<KatastralniUzemi[]> {
  const q = query.trim().toLocaleLowerCase('cs')
  if (q.length < 2) return []
  const all = await listKatastralniUzemi()
  return all
    .filter((ku) => ku.nazev.toLocaleLowerCase('cs').includes(q))
    .slice(0, 20)
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
