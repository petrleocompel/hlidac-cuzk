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

export type RizeniSnapshot = {
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

export type SnapshotChange =
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
      const typ =
        typeof d.typRizeni === 'string'
          ? d.typRizeni
          : (d.typRizeni?.kod ?? base.typRizeni)
      rizeni.push({
        id: String(d.id ?? base.id),
        typRizeni: typ,
        poradoveCislo: d.poradoveCislo ?? base.poradoveCislo,
        rok: d.rok ?? base.rok,
        kodPracoviste: d.kodPracoviste ?? base.kodPracoviste,
        datumPrijeti:
          typeof d.datumPrijeti === 'string' ? d.datumPrijeti : null,
        stav: typeof d.stav === 'string' ? d.stav : null,
        stavUhrady: typeof d.stavUhrady === 'string' ? d.stavUhrady : null,
        provedeneOperace: Array.isArray(d.provedeneOperace)
          ? d.provedeneOperace.map((op) => {
              const o = op
              return {
                nazev: o.nazev ?? 'Operace',
                datumProvedeni: o.datumProvedeni ?? null,
              }
            })
          : [],
        poznamky: Array.isArray(d.poznamky)
          ? d.poznamky.filter((p): p is string => typeof p === 'string')
          : [],
        isVklad: typ === 'V' || typ === 'ZPV',
      })
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
