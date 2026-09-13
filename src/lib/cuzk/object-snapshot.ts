import {
  buildParcelSnapshot,
  collectRizeniSnapshots,
  diffAttrValues,
  diffSnapshots,
  labelOfValue,
  lvFromDef,
  parseSnapshot,
  registerAttrLabels,
  rizeniSetChange,
} from './snapshot'
import type {
  AttrDef,
  LvSnapshot,
  ParcelAttrValue,
  ParcelCache,
  ParcelSnapshot,
  RizeniCache,
  RizeniSnapshot,
  SnapshotChange,
} from './snapshot'
import { getJednotkaById, getPravoStavbyById, getStavbaById } from './client'
import type { Jednotka, Parcela, PravoStavby, Stavba } from './client'

/** KN registers this application can subscribe to. */
export const OBJECT_TYPES = [
  'parcel',
  'stavba',
  'jednotka',
  'pravo_stavby',
] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  parcel: 'Parcela',
  stavba: 'Stavba',
  jednotka: 'Jednotka',
  pravo_stavby: 'Právo stavby',
}

export function objectTypeLabel(type: string): string {
  return type in OBJECT_TYPE_LABELS
    ? OBJECT_TYPE_LABELS[type as ObjectType]
    : type
}

export type ObjectAttrs = Record<string, ParcelAttrValue>

/** Links to other KN objects, so the UI can offer them without guessing ids. */
export type ObjectLinks = {
  parcelIds: string[]
  stavbaIds: string[]
  jednotkaIds: string[]
  pravoStavbyId: string | null
}

/**
 * One shape for buildings, units and rights of superficies: each register fills
 * its own attributes, while LV, plomby and links stay comparable.
 */
export type ObjectSnapshot = {
  version: 1
  objectType: Exclude<ObjectType, 'parcel'>
  fetchedAt: string
  aktualnostDatK: string | null
  object: {
    id: string
    /** Verified identification shown to the user, never invented locally. */
    summary: string
    kuKod: number | null
    kuNazev: string | null
    lv: LvSnapshot | null
    attrs: ObjectAttrs
    links: ObjectLinks
  }
  rizeni: RizeniSnapshot[]
}

export type WatchSnapshot = ParcelSnapshot | ObjectSnapshot

const STAVBA_ATTRS: ReadonlyArray<AttrDef> = [
  { field: 'typStavby', label: 'Typ stavby', kind: 'text' },
  { field: 'cislaDomovni', label: 'Čísla domovní', kind: 'list' },
  { field: 'castObce', label: 'Část obce', kind: 'text' },
  { field: 'obec', label: 'Obec', kind: 'text' },
  { field: 'docasna', label: 'Dočasná stavba', kind: 'flag' },
  { field: 'typVazby', label: 'Vazba stavby', kind: 'text' },
  { field: 'zpusobVyuziti', label: 'Způsob využití', kind: 'text' },
  { field: 'zpusobyOchrany', label: 'Způsoby ochrany', kind: 'list' },
  { field: 'parcely', label: 'Parcely stavby', kind: 'list' },
  { field: 'jednotky', label: 'Jednotky ve stavbě', kind: 'list' },
  { field: 'adresniMista', label: 'Adresní místa (RÚIAN)', kind: 'list' },
  {
    field: 'pravoStavbyId',
    label: 'Vazba na právo stavby (ISKN)',
    kind: 'text',
  },
]

const JEDNOTKA_ATTRS: ReadonlyArray<AttrDef> = [
  { field: 'cisloJednotky', label: 'Číslo jednotky', kind: 'text' },
  { field: 'typJednotky', label: 'Typ jednotky', kind: 'text' },
  { field: 'zpusobVyuziti', label: 'Způsob využití', kind: 'text' },
  { field: 'zpusobyOchrany', label: 'Způsoby ochrany', kind: 'list' },
  {
    field: 'podilNaSpolecnychCastech',
    label: 'Podíl na společných částech',
    kind: 'text',
  },
  { field: 'stavba', label: 'Vymezena ve stavbě', kind: 'text' },
  { field: 'stavbaId', label: 'Vazba na stavbu (ISKN)', kind: 'text' },
]

const PRAVO_STAVBY_ATTRS: ReadonlyArray<AttrDef> = [
  { field: 'datumUkonceni', label: 'Datum ukončení', kind: 'text' },
  { field: 'datumPrijeti', label: 'Datum přijetí', kind: 'text' },
  { field: 'ucely', label: 'Účely práva stavby', kind: 'list' },
  { field: 'zpusobyOchrany', label: 'Způsoby ochrany', kind: 'list' },
  { field: 'parcely', label: 'Parcely', kind: 'list' },
  { field: 'stavby', label: 'Stavby', kind: 'list' },
]

const ATTRS_BY_TYPE: Record<
  Exclude<ObjectType, 'parcel'>,
  ReadonlyArray<AttrDef>
> = {
  stavba: STAVBA_ATTRS,
  jednotka: JEDNOTKA_ATTRS,
  pravo_stavby: PRAVO_STAVBY_ATTRS,
}

for (const defs of Object.values(ATTRS_BY_TYPE)) registerAttrLabels(defs)

function parcelLabel(parcel: Partial<Parcela>): string {
  const number =
    parcel.poddeleniCislaParcely != null
      ? `${parcel.kmenoveCisloParcely ?? '?'}/${parcel.poddeleniCislaParcely}`
      : String(parcel.kmenoveCisloParcely ?? '?')
  const prefix = Number(parcel.druhCislovaniParcely) === 1 ? 'st. ' : ''
  const ku = parcel.katastralniUzemi?.nazev
  return `${prefix}${number}${ku ? ` (${ku})` : ''}${
    parcel.id != null ? ` [${parcel.id}]` : ''
  }`
}

function stavbaLabel(stavba: Partial<Stavba>): string {
  const cisla = Array.isArray(stavba.cislaDomovni)
    ? stavba.cislaDomovni.filter((value) => Number.isFinite(value))
    : []
  const typ = stavba.typStavby?.kod
  const marker =
    cisla.length === 0
      ? 'bez čísla'
      : `${typ === 2 ? 'č.e.' : 'č.p.'} ${cisla.join(', ')}`
  const place = stavba.castObce?.nazev ?? stavba.obec?.nazev
  return `${marker}${place ? `, ${place}` : ''}${
    stavba.id != null ? ` [${stavba.id}]` : ''
  }`
}

function listOf(values: unknown[] | null | undefined): string[] | null {
  if (!Array.isArray(values)) return null
  return values
    .map((value) => labelOfValue(value))
    .filter((value): value is string => Boolean(value))
}

function podil(
  value: { citatel?: number; jmenovatel?: number } | null | undefined,
): string | null {
  if (!value || value.citatel == null || value.jmenovatel == null) return null
  return `${value.citatel}/${value.jmenovatel}`
}

function stavbaAttrs(stavba: Stavba): {
  attrs: ObjectAttrs
  links: ObjectLinks
  summary: string
} {
  const parcely = Array.isArray(stavba.parcely) ? stavba.parcely : null
  const jednotky = Array.isArray(stavba.jednotky) ? stavba.jednotky : null
  return {
    summary: stavbaLabel(stavba),
    attrs: {
      typStavby: stavba.typStavby?.nazev ?? null,
      cislaDomovni: Array.isArray(stavba.cislaDomovni)
        ? stavba.cislaDomovni.map(String)
        : null,
      castObce: stavba.castObce?.nazev ?? null,
      obec: stavba.obec?.nazev ?? null,
      docasna: typeof stavba.docasna === 'boolean' ? stavba.docasna : null,
      typVazby: typeof stavba.typyVazby === 'string' ? stavba.typyVazby : null,
      zpusobVyuziti: labelOfValue(stavba.zpusobVyuziti),
      zpusobyOchrany: listOf(stavba.zpusobyOchrany),
      parcely: parcely?.map(parcelLabel) ?? null,
      jednotky:
        jednotky?.map(
          (unit) =>
            `${unit.cisloJednotky ?? '?'}${unit.id != null ? ` [${unit.id}]` : ''}`,
        ) ?? null,
      // RÚIAN address places; they are not KN identifiers and are never followed.
      adresniMista: Array.isArray(stavba.adresniMista)
        ? stavba.adresniMista.map(String)
        : null,
      pravoStavbyId:
        stavba.pravoStavby?.id != null ? String(stavba.pravoStavby.id) : null,
    },
    links: {
      parcelIds:
        parcely
          ?.map((parcel) => (parcel.id != null ? String(parcel.id) : ''))
          .filter(Boolean) ?? [],
      stavbaIds: [],
      jednotkaIds:
        jednotky
          ?.map((unit) => (unit.id != null ? String(unit.id) : ''))
          .filter(Boolean) ?? [],
      pravoStavbyId:
        stavba.pravoStavby?.id != null ? String(stavba.pravoStavby.id) : null,
    },
  }
}

function jednotkaAttrs(unit: Jednotka): {
  attrs: ObjectAttrs
  links: ObjectLinks
  summary: string
} {
  const stavba = unit.vymezenaVeStavbe ?? null
  return {
    summary: `jednotka ${unit.cisloJednotky ?? '?'}${
      stavba ? ` v ${stavbaLabel(stavba)}` : ''
    }`,
    attrs: {
      cisloJednotky:
        unit.cisloJednotky != null ? String(unit.cisloJednotky) : null,
      typJednotky: unit.typJednotky?.nazev ?? null,
      zpusobVyuziti: labelOfValue(unit.zpusobVyuziti),
      zpusobyOchrany: listOf(unit.zpusobyOchrany),
      podilNaSpolecnychCastech: podil(unit.podilNaSpolecnychCastechDomu),
      stavba: stavba ? stavbaLabel(stavba) : null,
      stavbaId: stavba?.id != null ? String(stavba.id) : null,
    },
    links: {
      parcelIds: [],
      stavbaIds: stavba?.id != null ? [String(stavba.id)] : [],
      jednotkaIds: [],
      pravoStavbyId: null,
    },
  }
}

function pravoStavbyAttrs(pravo: PravoStavby): {
  attrs: ObjectAttrs
  links: ObjectLinks
  summary: string
} {
  const parcely = Array.isArray(pravo.parcely) ? pravo.parcely : null
  const stavby = Array.isArray(pravo.stavby) ? pravo.stavby : null
  return {
    summary: `právo stavby${pravo.id != null ? ` [${pravo.id}]` : ''}${
      pravo.datumUkonceni ? `, končí ${pravo.datumUkonceni.slice(0, 10)}` : ''
    }`,
    attrs: {
      datumUkonceni: pravo.datumUkonceni ?? null,
      datumPrijeti: pravo.datumPrijeti ?? null,
      ucely: listOf(pravo.ucelyPravaStavby),
      zpusobyOchrany: listOf(pravo.zpusobyOchrany),
      parcely: parcely?.map(parcelLabel) ?? null,
      stavby: stavby?.map(stavbaLabel) ?? null,
    },
    links: {
      parcelIds:
        parcely
          ?.map((parcel) => (parcel.id != null ? String(parcel.id) : ''))
          .filter(Boolean) ?? [],
      stavbaIds:
        stavby
          ?.map((stavba) => (stavba.id != null ? String(stavba.id) : ''))
          .filter(Boolean) ?? [],
      jednotkaIds: [],
      pravoStavbyId: null,
    },
  }
}

export type ObjectFetch = {
  data?: Stavba | Jednotka | PravoStavby
  aktualnostDatK?: string
}

const FETCHERS: Record<
  Exclude<ObjectType, 'parcel'>,
  (id: string | number, signal?: AbortSignal) => Promise<ObjectFetch>
> = {
  stavba: getStavbaById,
  jednotka: getJednotkaById,
  pravo_stavby: getPravoStavbyById,
}

/** Builds a snapshot from an already fetched register answer. */
export async function objectSnapshotFrom(
  objectType: Exclude<ObjectType, 'parcel'>,
  response: ObjectFetch,
  now = new Date(),
  signal?: AbortSignal,
  rizeniCache: RizeniCache = new Map(),
): Promise<ObjectSnapshot> {
  const data = response.data
  if (!data) throw new Error('Prázdná odpověď ČÚZK')
  const detail =
    objectType === 'stavba'
      ? stavbaAttrs(data)
      : objectType === 'jednotka'
        ? jednotkaAttrs(data)
        : pravoStavbyAttrs(data)
  const lv = lvFromDef(data.lv)
  const rizeni = await collectRizeniSnapshots(
    Array.isArray(data.rizeniPlomby) ? data.rizeniPlomby : [],
    now,
    signal,
    rizeniCache,
  )
  return {
    version: 1,
    objectType,
    fetchedAt: now.toISOString(),
    aktualnostDatK: response.aktualnostDatK ?? null,
    object: {
      id: data.id != null ? String(data.id) : '',
      summary: detail.summary,
      kuKod: lv?.kuKod ?? null,
      kuNazev: lv?.kuNazev ?? null,
      lv,
      attrs: detail.attrs,
      links: detail.links,
    },
    rizeni,
  }
}

/** Builds a snapshot of a building, unit or right of superficies by ISKN id. */
export async function buildObjectSnapshot(
  objectType: Exclude<ObjectType, 'parcel'>,
  isknId: string | number,
  now = new Date(),
  signal?: AbortSignal,
  rizeniCache: RizeniCache = new Map(),
): Promise<ObjectSnapshot> {
  const response = await FETCHERS[objectType](isknId, signal)
  signal?.throwIfAborted()
  return objectSnapshotFrom(objectType, response, now, signal, rizeniCache)
}

/** One entry point for every register, so callers only pass the watch type. */
export async function buildWatchSnapshot(
  objectType: ObjectType,
  isknId: string | number,
  now = new Date(),
  options: {
    signal?: AbortSignal
    rizeniCache?: RizeniCache
    parcelCache?: ParcelCache
  } = {},
): Promise<WatchSnapshot> {
  if (objectType === 'parcel')
    return buildParcelSnapshot(
      isknId,
      now,
      options.signal,
      options.rizeniCache,
      options.parcelCache,
    )
  return buildObjectSnapshot(
    objectType,
    isknId,
    now,
    options.signal,
    options.rizeniCache,
  )
}

export function isObjectSnapshot(
  snapshot: WatchSnapshot | null,
): snapshot is ObjectSnapshot {
  return Boolean(snapshot && 'object' in snapshot)
}

/** Reads a stored snapshot of any register; legacy payloads stay parcels. */
export function parseWatchSnapshot(raw: unknown): WatchSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return parseSnapshot(raw)
  const value = raw as {
    version?: unknown
    objectType?: unknown
    fetchedAt?: unknown
    aktualnostDatK?: unknown
    object?: unknown
    rizeni?: unknown
  }
  const type = typeof value.objectType === 'string' ? value.objectType : null
  if (
    value.version !== 1 ||
    !type ||
    type === 'parcel' ||
    !OBJECT_TYPES.includes(type as ObjectType) ||
    !value.object ||
    typeof value.object !== 'object'
  )
    return parseSnapshot(raw)
  const object = value.object as Record<string, unknown>
  const links = (object.links ?? {}) as Record<string, unknown>
  const strings = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.filter((entry): entry is string => typeof entry === 'string')
      : []
  return {
    version: 1,
    objectType: type as Exclude<ObjectType, 'parcel'>,
    fetchedAt:
      typeof value.fetchedAt === 'string'
        ? value.fetchedAt
        : new Date(0).toISOString(),
    aktualnostDatK:
      typeof value.aktualnostDatK === 'string' ? value.aktualnostDatK : null,
    object: {
      id: typeof object.id === 'string' ? object.id : '',
      summary: typeof object.summary === 'string' ? object.summary : '',
      kuKod: typeof object.kuKod === 'number' ? object.kuKod : null,
      kuNazev: typeof object.kuNazev === 'string' ? object.kuNazev : null,
      lv: (object.lv as LvSnapshot | null | undefined) ?? null,
      attrs: (object.attrs as ObjectAttrs | undefined) ?? {},
      links: {
        parcelIds: strings(links.parcelIds),
        stavbaIds: strings(links.stavbaIds),
        jednotkaIds: strings(links.jednotkaIds),
        pravoStavbyId:
          typeof links.pravoStavbyId === 'string' ? links.pravoStavbyId : null,
      },
    },
    rizeni: Array.isArray(value.rizeni)
      ? (value.rizeni as RizeniSnapshot[])
      : [],
  }
}

export function snapshotObjectType(snapshot: WatchSnapshot | null): ObjectType {
  return isObjectSnapshot(snapshot) ? snapshot.objectType : 'parcel'
}

export function snapshotLv(snapshot: WatchSnapshot | null): LvSnapshot | null {
  if (!snapshot) return null
  return isObjectSnapshot(snapshot) ? snapshot.object.lv : snapshot.parcel.lv
}

export function snapshotRizeni(
  snapshot: WatchSnapshot | null,
): RizeniSnapshot[] {
  return snapshot?.rizeni ?? []
}

/** Compares two snapshots of the same register; different types never mix. */
export function diffWatchSnapshots(
  previous: WatchSnapshot | null,
  next: WatchSnapshot,
): SnapshotChange[] {
  if (!previous) return []
  if (snapshotObjectType(previous) !== snapshotObjectType(next)) return []
  if (!isObjectSnapshot(previous) || !isObjectSnapshot(next))
    return diffSnapshots(previous as ParcelSnapshot, next as ParcelSnapshot)

  const changes: SnapshotChange[] = []
  const rizeni = rizeniSetChange(previous.rizeni, next.rizeni)
  if (rizeni) changes.push(rizeni)
  if (
    JSON.stringify(previous.object.lv ?? null) !==
    JSON.stringify(next.object.lv ?? null)
  )
    changes.push({
      kind: 'lv_change',
      previous: previous.object.lv,
      next: next.object.lv,
    })
  const values = diffAttrValues(
    ATTRS_BY_TYPE[next.objectType],
    previous.object.attrs,
    next.object.attrs,
  )
  if (values.length)
    changes.push({
      kind: 'parcel_attrs',
      fields: values.map((value) => value.field),
      values,
    })
  return changes
}

/** Attribute definitions of a register, in display order. */
export function objectAttrDefs(type: ObjectType): ReadonlyArray<AttrDef> {
  return type === 'parcel' ? [] : ATTRS_BY_TYPE[type]
}

/** One identification line for any register; never prints empty parcel data. */
export function describeWatchObject(watch: {
  objectType: string
  objectSummary?: string | null
  kuName?: string | null
  kuCode?: string | null
  parcelNumber?: number | null
  parcelSubdivision?: number | null
}): string {
  const place = watch.kuName
    ? `${watch.kuName}${watch.kuCode ? ` (${watch.kuCode})` : ''}`
    : (watch.kuCode ?? null)
  if (watch.objectType === 'parcel') {
    const number =
      watch.parcelNumber != null
        ? watch.parcelSubdivision != null
          ? `${watch.parcelNumber}/${watch.parcelSubdivision}`
          : String(watch.parcelNumber)
        : null
    return [place, number].filter(Boolean).join(' · ') || 'Parcela'
  }
  return [
    `${objectTypeLabel(watch.objectType)}${
      watch.objectSummary ? ` ${watch.objectSummary}` : ''
    }`,
    place,
  ]
    .filter(Boolean)
    .join(' · ')
}
