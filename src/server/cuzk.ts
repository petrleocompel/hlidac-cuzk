import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { searchKatastralniUzemi } from '#/lib/cuzk/client'
import { parseParcelNumber } from '#/lib/cuzk/parcel-input'
import { lookupParcelForWatch } from '#/lib/cuzk/watch-create'
import type { ParcelLookup } from '#/lib/cuzk/watch-create'

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
