import { CuzkHttpError, CuzkUnavailableError } from './policy'
import { formatRizeniLabel, getParcelById, getRizeniById } from './client'
import type { CuzkItemResponse, Parcela, RizeniDef } from './client'

export type RizeniCache = Map<string, Promise<CuzkItemResponse<RizeniDef>>>

export type KodNazev = { kod?: number | string | null; nazev?: string | null }

export type LvSnapshot = {
  id: string | null
  cislo: number | null
  kuKod: number | null
  kuNazev: string | null
}

export type RizeniDetailField = 'stav' | 'stavUhrady' | 'provedeneOperace'

export type RizeniSnapshot = {
  detailAvailable?: boolean
  detailsFetchedAt?: string | null
  availableFields?: RizeniDetailField[]
  knownFields?: RizeniDetailField[]
  navazanaRizeni?: Array<
    Pick<
      RizeniSnapshot,
      'id' | 'typRizeni' | 'poradoveCislo' | 'rok' | 'kodPracoviste'
    >
  >
  id: string
  typRizeni: string | null
  poradoveCislo: number | null
  rok: number | null
  kodPracoviste: number | null
  datumPrijeti: string | null
  stav: string | null
  stavUhrady: string | null
  provedeneOperace: Array<{ nazev: string; datumProvedeni: string | null }>
  poznamky: string[]
  /** Vklad ≈ změna právního vztahu / vlastnictví */
  isVklad: boolean
}

export type ParcelSnapshot = {
  version: 1
  fetchedAt: string
  aktualnostDatK: string | null
  parcel: {
    id: string
    typParcely: string | null
    druhCislovaniParcely: number | null
    kmenoveCisloParcely: number | null
    poddeleniCislaParcely: number | null
    kuKod: number | null
    kuNazev: string | null
    vymera: number | null
    lv: LvSnapshot | null
    mapovyList: string | null
    zpusobUrceniVymery: string | null
    druhPozemku: string | null
    zpusobVyuziti: string | null
    zpusobyOchrany: string[]
    bpej: Array<{ kod: number | null; vymera: number | null }>
    definicniBod: { x: number | null; y: number | null } | null
    stavbaId: string | null
    pravoStavbyId: string | null
  }
  rizeni: RizeniSnapshot[]
}

export type RizeniProgressChange = {
  kind: 'rizeni_progress'
  previous: RizeniSnapshot
  next: RizeniSnapshot
  fields: RizeniDetailField[]
  addedOperations: RizeniSnapshot['provedeneOperace']
  /** The řízení is no longer a plomba on the parcel; we still follow it. */
  followed: boolean
}

export type SnapshotChange =
  | RizeniProgressChange
  | { kind: 'new_rizeni'; added: RizeniSnapshot[]; removed: RizeniSnapshot[] }
  | {
      kind: 'lv_change'
      previous: LvSnapshot | null
      next: LvSnapshot | null
    }
  | {
      kind: 'parcel_attrs'
      fields: string[]
    }

const RIZENI_TYPE_LABELS: Record<string, string> = {
  V: 'Vklad',
  Z: 'Záznam',
  PGP: 'Potvrzení geometrického plánu',
  PD: 'Podací deník',
  ZPV: 'Pomocné řízení V',
}

export function rizeniTypeLabel(typ: string | null | undefined): string {
  if (!typ) return 'Řízení'
  return RIZENI_TYPE_LABELS[typ] ?? typ
}

const STAV_UHRADY_LABELS: Record<string, string> = {
  U: 'uhrazeno',
  N: 'neuhrazeno',
  O: 'osvobozeno od úhrady',
}

/** Unknown or missing codes must stay visible as unknown, never as a value. */
export function stavUhradyLabel(code: string | null | undefined): string {
  if (!code) return 'neznámý stav úhrady'
  return STAV_UHRADY_LABELS[code] ?? code
}

/** Tolerant reader for a stored RizeniSnapshot (tracked řízení detail). */
export function parseRizeniSnapshot(raw: unknown): RizeniSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Partial<RizeniSnapshot>
  if (typeof value.id !== 'string') return null
  return {
    ...value,
    id: value.id,
    typRizeni: value.typRizeni ?? null,
    poradoveCislo: value.poradoveCislo ?? null,
    rok: value.rok ?? null,
    kodPracoviste: value.kodPracoviste ?? null,
    datumPrijeti: value.datumPrijeti ?? null,
    stav: value.stav ?? null,
    stavUhrady: value.stavUhrady ?? null,
    provedeneOperace: Array.isArray(value.provedeneOperace)
      ? value.provedeneOperace
      : [],
    poznamky: Array.isArray(value.poznamky) ? value.poznamky : [],
    isVklad: value.isVklad === true,
  }
}

function asKodNazev(value: unknown): KodNazev | null {
  if (!value || typeof value !== 'object') return null
  return value
}

function labelOf(value: unknown): string | null {
  const kn = asKodNazev(value)
  if (!kn) return typeof value === 'string' ? value : null
  return kn.nazev ?? (kn.kod != null ? String(kn.kod) : null)
}

function lvFromParcel(parcel: Parcela): LvSnapshot | null {
  const lv = parcel.lv
  if (!lv) return null
  return {
    id: lv.id != null ? String(lv.id) : null,
    cislo: lv.cislo ?? null,
    kuKod: lv.katastralniUzemi?.kod ?? null,
    kuNazev: lv.katastralniUzemi?.nazev ?? null,
  }
}

function baseRizeni(r: RizeniDef): RizeniSnapshot {
  const typ =
    typeof r.typRizeni === 'string' ? r.typRizeni : (r.typRizeni?.kod ?? null)
  return {
    detailAvailable: false,
    availableFields: [],
    knownFields: [],
    detailsFetchedAt: null,
    navazanaRizeni: [],
    id: String(r.id ?? `${r.poradoveCislo}-${r.rok}`),
    typRizeni: typ,
    poradoveCislo: r.poradoveCislo ?? null,
    rok: r.rok ?? null,
    kodPracoviste: r.kodPracoviste ?? null,
    datumPrijeti: null,
    stav: null,
    stavUhrady: null,
    provedeneOperace: [],
    poznamky: [],
    isVklad: typ === 'V' || typ === 'ZPV',
  }
}

/** Nullable API fields mean unavailable information, not a confirmed removal. */
export function normalizeRizeni(
  detail: RizeniDef,
  now = new Date(),
  fallback = baseRizeni(detail),
): RizeniSnapshot {
  const typ =
    typeof detail.typRizeni === 'string'
      ? detail.typRizeni
      : (detail.typRizeni?.kod ?? fallback.typRizeni)
  const availableFields: RizeniDetailField[] = []
  if (typeof detail.stav === 'string') availableFields.push('stav')
  if (typeof detail.stavUhrady === 'string') availableFields.push('stavUhrady')
  if (Array.isArray(detail.provedeneOperace))
    availableFields.push('provedeneOperace')
  return {
    ...fallback,
    id: String(detail.id ?? fallback.id),
    typRizeni: typ,
    poradoveCislo: detail.poradoveCislo ?? fallback.poradoveCislo,
    rok: detail.rok ?? fallback.rok,
    kodPracoviste: detail.kodPracoviste ?? fallback.kodPracoviste,
    datumPrijeti:
      typeof detail.datumPrijeti === 'string' ? detail.datumPrijeti : null,
    stav: typeof detail.stav === 'string' ? detail.stav : null,
    stavUhrady:
      typeof detail.stavUhrady === 'string' ? detail.stavUhrady : null,
    provedeneOperace: Array.isArray(detail.provedeneOperace)
      ? detail.provedeneOperace.map((op) => ({
          nazev: op.nazev ?? 'Operace',
          datumProvedeni: op.datumProvedeni ?? null,
        }))
      : [],
    poznamky: Array.isArray(detail.poznamky)
      ? detail.poznamky.filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    navazanaRizeni: Array.isArray(detail.navazanaRizeni)
      ? detail.navazanaRizeni.filter((r) => r.id != null).map(baseRizeni)
      : [],
    isVklad: typ === 'V' || typ === 'ZPV',
    detailAvailable: true,
    detailsFetchedAt: now.toISOString(),
    availableFields,
    knownFields: availableFields,
  }
}

function knownFields(r: RizeniSnapshot): RizeniDetailField[] {
  // Older snapshots did not distinguish an empty operation list from failed detail.
  return (
    r.knownFields ??
    r.availableFields ?? [
      ...(r.stav != null ? ['stav' as const] : []),
      ...(r.stavUhrady != null ? ['stavUhrady' as const] : []),
      ...(r.provedeneOperace.length ? ['provedeneOperace' as const] : []),
    ]
  )
}

export function mergeRizeniDetails(
  previous: RizeniSnapshot | undefined,
  next: RizeniSnapshot,
): RizeniSnapshot {
  if (!previous) return next
  const available = next.availableFields ?? knownFields(next)
  return {
    ...next,
    stav: available.includes('stav') ? next.stav : previous.stav,
    stavUhrady: available.includes('stavUhrady')
      ? next.stavUhrady
      : previous.stavUhrady,
    provedeneOperace: available.includes('provedeneOperace')
      ? next.provedeneOperace
      : previous.provedeneOperace,
    knownFields: [...new Set([...knownFields(previous), ...available])],
    ...(next.detailAvailable === false
      ? {
          datumPrijeti: previous.datumPrijeti,
          poznamky: previous.poznamky,
          navazanaRizeni: previous.navazanaRizeni,
          detailsFetchedAt: previous.detailsFetchedAt ?? null,
        }
      : {}),
  }
}

function operationKey(op: RizeniSnapshot['provedeneOperace'][number]): string {
  return JSON.stringify([op.nazev.trim(), op.datumProvedeni])
}

export function diffRizeni(
  previous: RizeniSnapshot,
  next: RizeniSnapshot,
  includePayment = true,
): RizeniProgressChange | null {
  if (next.detailAvailable === false) return null
  const available = next.availableFields ?? knownFields(next)
  const known = knownFields(previous)
  const fields: RizeniDetailField[] = []
  if (
    available.includes('stav') &&
    known.includes('stav') &&
    previous.stav !== next.stav
  )
    fields.push('stav')
  if (
    includePayment &&
    available.includes('stavUhrady') &&
    known.includes('stavUhrady') &&
    previous.stavUhrady !== next.stavUhrady
  )
    fields.push('stavUhrady')
  const before = new Set(previous.provedeneOperace.map(operationKey))
  const seen = new Set<string>()
  const addedOperations =
    available.includes('provedeneOperace') && known.includes('provedeneOperace')
      ? next.provedeneOperace.filter((op) => {
          const key = operationKey(op)
          if (before.has(key) || seen.has(key)) return false
          seen.add(key)
          return true
        })
      : []
  if (addedOperations.length) fields.push('provedeneOperace')
  return fields.length
    ? {
        kind: 'rizeni_progress',
        previous,
        next,
        fields,
        addedOperations,
        followed: false,
      }
    : null
}

export async function buildParcelSnapshot(
  isknId: string | number,
  now = new Date(),
  signal?: AbortSignal,
  rizeniCache: RizeniCache = new Map(),
): Promise<ParcelSnapshot> {
  const response = await getParcelById(isknId, signal)
  const parcel = response.data
  if (!parcel) throw new Error('Prázdná odpověď ČÚZK')

  const plomby = Array.isArray(parcel.rizeniPlomby) ? parcel.rizeniPlomby : []
  const rizeni: RizeniSnapshot[] = []

  for (const item of plomby) {
    const base = baseRizeni(item)
    if (item.id == null) {
      rizeni.push(base)
      continue
    }
    try {
      const cacheKey = String(item.id)
      let detail = rizeniCache.get(cacheKey)
      if (!detail) {
        detail = getRizeniById(item.id, signal)
        rizeniCache.set(cacheKey, detail)
      }
      const detailRes = await detail
      const d = detailRes.data
      if (!d) {
        rizeni.push(base)
        continue
      }
      rizeni.push(normalizeRizeni(d, now, base))
    } catch (error) {
      if (
        error instanceof CuzkUnavailableError ||
        (error instanceof CuzkHttpError &&
          [401, 403, 429].includes(error.status))
      )
        throw error
      signal?.throwIfAborted()
      rizeni.push(base)
    }
  }

  const bpejRaw = Array.isArray(parcel.bpej) ? parcel.bpej : []
  const ochronaRaw = Array.isArray(parcel.zpusobyOchrany)
    ? parcel.zpusobyOchrany
    : []
  const bod = parcel.definicniBod
  const mapovy = parcel.mapovyList
  const stavba = parcel.stavba
  const pravo = parcel.pravoStavby

  return {
    version: 1,
    fetchedAt: now.toISOString(),
    aktualnostDatK: response.aktualnostDatK ?? null,
    parcel: {
      id: String(parcel.id ?? isknId),
      typParcely: parcel.typParcely ?? null,
      druhCislovaniParcely:
        typeof parcel.druhCislovaniParcely === 'number'
          ? parcel.druhCislovaniParcely
          : Number(parcel.druhCislovaniParcely) || null,
      kmenoveCisloParcely: parcel.kmenoveCisloParcely ?? null,
      poddeleniCislaParcely: parcel.poddeleniCislaParcely ?? null,
      kuKod: parcel.katastralniUzemi?.kod ?? null,
      kuNazev: parcel.katastralniUzemi?.nazev ?? null,
      vymera: typeof parcel.vymera === 'number' ? parcel.vymera : null,
      lv: lvFromParcel(parcel),
      mapovyList: mapovy?.oznaceni ?? null,
      zpusobUrceniVymery: labelOf(parcel.zpusobUrceniVymery),
      druhPozemku: labelOf(parcel.druhPozemku),
      zpusobVyuziti: labelOf(parcel.zpusobVyuziti),
      zpusobyOchrany: ochronaRaw
        .map((o) => labelOf(o))
        .filter((s): s is string => Boolean(s)),
      bpej: bpejRaw.map((b) => {
        const row = b as { kod?: number; vymera?: number }
        return { kod: row.kod ?? null, vymera: row.vymera ?? null }
      }),
      definicniBod:
        bod && (bod.x != null || bod.y != null)
          ? { x: bod.x ?? null, y: bod.y ?? null }
          : null,
      stavbaId: stavba?.id != null ? String(stavba.id) : null,
      pravoStavbyId: pravo?.id != null ? String(pravo.id) : null,
    },
    rizeni,
  }
}

/** Accepts current v1 snapshots or legacy array-of-rizeni payloads. */
export function parseSnapshot(raw: unknown): ParcelSnapshot | null {
  if (raw == null) return null

  if (Array.isArray(raw)) {
    return {
      version: 1,
      fetchedAt: new Date(0).toISOString(),
      aktualnostDatK: null,
      parcel: {
        id: '',
        typParcely: null,
        druhCislovaniParcely: null,
        kmenoveCisloParcely: null,
        poddeleniCislaParcely: null,
        kuKod: null,
        kuNazev: null,
        vymera: null,
        lv: null,
        mapovyList: null,
        zpusobUrceniVymery: null,
        druhPozemku: null,
        zpusobVyuziti: null,
        zpusobyOchrany: [],
        bpej: [],
        definicniBod: null,
        stavbaId: null,
        pravoStavbyId: null,
      },
      rizeni: raw.map((item) => baseRizeni(item as RizeniDef)),
    }
  }

  if (typeof raw !== 'object') return null
  const obj = raw as Partial<ParcelSnapshot>
  if (obj.version === 1 && obj.parcel && Array.isArray(obj.rizeni)) {
    return obj as ParcelSnapshot
  }
  return null
}

function lvKey(lv: LvSnapshot | null): string {
  if (!lv) return ''
  return `${lv.id ?? ''}:${lv.cislo ?? ''}`
}

function rizeniIds(items: RizeniSnapshot[]): Set<string> {
  return new Set(items.map((r) => r.id))
}

export function diffSnapshots(
  previous: ParcelSnapshot | null,
  next: ParcelSnapshot,
): SnapshotChange[] {
  if (!previous) return []

  const changes: SnapshotChange[] = []
  const prevIds = rizeniIds(previous.rizeni)
  const nextIds = rizeniIds(next.rizeni)
  const added = next.rizeni.filter((r) => !prevIds.has(r.id))
  const removed = previous.rizeni.filter((r) => !nextIds.has(r.id))
  if (added.length > 0 || removed.length > 0) {
    changes.push({ kind: 'new_rizeni', added, removed })
  }

  if (lvKey(previous.parcel.lv) !== lvKey(next.parcel.lv)) {
    changes.push({
      kind: 'lv_change',
      previous: previous.parcel.lv,
      next: next.parcel.lv,
    })
  }

  const fields: string[] = []
  const p = previous.parcel
  const n = next.parcel
  if (p.vymera !== n.vymera) fields.push('vymera')
  if (p.druhPozemku !== n.druhPozemku) fields.push('druhPozemku')
  if (p.zpusobVyuziti !== n.zpusobVyuziti) fields.push('zpusobVyuziti')
  if (JSON.stringify(p.zpusobyOchrany) !== JSON.stringify(n.zpusobyOchrany)) {
    fields.push('zpusobyOchrany')
  }
  if (JSON.stringify(p.bpej) !== JSON.stringify(n.bpej)) fields.push('bpej')
  if (fields.length > 0) {
    changes.push({ kind: 'parcel_attrs', fields })
  }

  return changes
}

export function formatParcelNumber(snapshot: ParcelSnapshot): string {
  const k = snapshot.parcel.kmenoveCisloParcely
  const p = snapshot.parcel.poddeleniCislaParcely
  if (k == null) return '—'
  return p != null ? `${k}/${p}` : String(k)
}

export function formatLvLabel(lv: LvSnapshot | null): string {
  if (!lv?.cislo) return '—'
  return `LV ${lv.cislo}`
}

export function formatRizeniHeadline(r: RizeniSnapshot): string {
  return `${rizeniTypeLabel(r.typRizeni)} ${formatRizeniLabel({
    typRizeni: r.typRizeni ?? undefined,
    poradoveCislo: r.poradoveCislo ?? undefined,
    rok: r.rok ?? undefined,
    id: Number(r.id) || undefined,
  })}`
}
