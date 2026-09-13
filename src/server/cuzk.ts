import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { searchCastObce, searchKatastralniUzemi } from '#/lib/cuzk/client'
import type { TypStavbyQuery } from '#/lib/cuzk/client'
import { parseParcelNumber } from '#/lib/cuzk/parcel-input'
import {
  lookupAddressForWatch,
  lookupBuildingOrUnit,
  lookupObjectForWatch,
  lookupParcelForWatch,
} from '#/lib/cuzk/watch-create'
import type {
  AddressResolution,
  ObjectLookup,
  ParcelLookup,
} from '#/lib/cuzk/watch-create'
import { resolveAddressPlaces, suggestAddresses } from '#/lib/ruian/geocode'
import type { AddressPlace } from '#/lib/ruian/geocode'

const SearchKuInput = z.object({
  query: z.string().min(2).max(100),
})

export const searchKu = createServerFn({ method: 'GET' })
  .inputValidator((v) => SearchKuInput.parse(v))
  .handler(async ({ data }) => {
    await requireSession()
    const rows = await searchKatastralniUzemi(data.query)
    return rows.map((ku) => ({
      kod: String(ku.kod),
      nazev: ku.nazev,
    }))
  })

const LookupParcelInput = z.object({
  kuCode: z.string().regex(/^\d{1,20}$/, 'Kód KÚ musí být číslo.'),
  parcel: z.string().min(1).max(40),
})

/**
 * Verifies the parcel in ČÚZK before anything is stored. The returned code and
 * name come from the API answer, so editing the form cannot decouple them.
 */
export const lookupParcel = createServerFn({ method: 'POST' })
  .inputValidator((v) => LookupParcelInput.parse(v))
  .handler(async ({ data }): Promise<ParcelLookup> => {
    const session = await requireSession()
    const parsed = parseParcelNumber(data.parcel)
    return lookupParcelForWatch(session.user.id, {
      kuCode: data.kuCode,
      kmenoveCisloParcely: parsed.kmenoveCisloParcely,
      poddeleniCislaParcely: parsed.poddeleniCislaParcely,
      druhCislovani: parsed.druhCislovani,
    })
  })

const SearchCastObceInput = z.object({
  query: z.string().min(2).max(100),
})

/** RÚIAN parts of municipalities; their codes are never KN identifiers. */
export const searchCastiObci = createServerFn({ method: 'GET' })
  .inputValidator((v) => SearchCastObceInput.parse(v))
  .handler(async ({ data }) => {
    await requireSession()
    const rows = await searchCastObce(data.query)
    return rows.map((entry) => ({
      kod: String(entry.kod),
      nazev: entry.nazev,
      obec: entry.nazevObce ?? null,
    }))
  })

const LookupObjectInput = z.object({
  objectType: z.enum(['stavba', 'jednotka', 'pravo_stavby']),
  isknId: z.string().regex(/^[1-9]\d{0,27}$/, 'ISKN id musí být číslo.'),
})

/** Verifies a building, unit or right of superficies by its ISKN id. */
export const lookupObject = createServerFn({ method: 'POST' })
  .inputValidator((v) => LookupObjectInput.parse(v))
  .handler(async ({ data }): Promise<ObjectLookup> => {
    const session = await requireSession()
    return lookupObjectForWatch(session.user.id, data.objectType, data.isknId)
  })

const LookupBuildingInput = z
  .object({
    objectType: z.enum(['stavba', 'jednotka']),
    kodCastiObce: z.coerce.number().int().min(1).max(999_999),
    typStavby: z.coerce.number().int().min(1).max(2),
    cisloDomovni: z.coerce.number().int().min(1).max(99_999),
    cisloJednotky: z.coerce
      .number()
      .int()
      .min(0)
      .max(99_999_999)
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.objectType === 'stavba' || value.cisloJednotky != null,
    'U jednotky zadejte i číslo jednotky.',
  )

/** Searches a building or unit; the confirmed detail decides what is stored. */
export const lookupBuilding = createServerFn({ method: 'POST' })
  .inputValidator((v) => LookupBuildingInput.parse(v))
  .handler(async ({ data }): Promise<ObjectLookup> => {
    const session = await requireSession()
    return lookupBuildingOrUnit(session.user.id, {
      objectType: data.objectType,
      kodCastiObce: data.kodCastiObce,
      typStavby: data.typStavby as TypStavbyQuery,
      cisloDomovni: data.cisloDomovni,
      cisloJednotky: data.cisloJednotky ?? null,
    })
  })

const SuggestAddressInput = z.object({
  query: z.string().min(3).max(120),
})

/** RÚIAN suggestions; this service is free of the ČÚZK KN request budget. */
export const suggestAddress = createServerFn({ method: 'GET' })
  .inputValidator((v) => SuggestAddressInput.parse(v))
  .handler(async ({ data }): Promise<{ suggestions: string[] }> => {
    await requireSession()
    const rows = await suggestAddresses(data.query)
    return { suggestions: rows.map((row) => row.text) }
  })

const LookupAddressInput = z.object({
  address: z.string().min(3).max(200),
  /** Chosen address place when one address text matched several places. */
  kod: z.coerce.number().int().min(1).optional(),
})

export type AddressLookupResult = {
  places: AddressPlace[]
  resolved: AddressResolution | null
}

/**
 * An address is only accepted when RÚIAN matches it exactly. An ambiguous or
 * unmatched address returns the candidates instead of a silent best guess.
 */
export const lookupAddress = createServerFn({ method: 'POST' })
  .inputValidator((v) => LookupAddressInput.parse(v))
  .handler(async ({ data }): Promise<AddressLookupResult> => {
    const session = await requireSession()
    const places = await resolveAddressPlaces(data.address)
    const chosen =
      data.kod != null
        ? (places.find((place) => place.kod === data.kod) ?? null)
        : places.length === 1
          ? places[0]
          : null
    if (!chosen) return { places, resolved: null }
    return {
      places,
      resolved: await lookupAddressForWatch(session.user.id, chosen),
    }
  })
