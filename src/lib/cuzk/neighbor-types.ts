import { z } from 'zod'

/** Identification taken from a verified ČÚZK answer, never from user input. */
export type VerifiedParcel = {
  isknId: string
  kuCode: string
  kuName: string
  parcelNumber: number
  parcelSubdivision: number | null
  druhCislovani: number
  typParcely: string | null
  vymera: number | null
  druhPozemku: string | null
  lvCislo: number | null
  plomby: number | null
}

/** Browser-safe neighbor selection limits and Zod input (no DB imports). */
export const MAX_NEIGHBOR_SELECTION = 20

export const NeighborSelection = z.object({
  watchId: z.string().uuid(),
  ids: z
    .array(z.string().regex(/^[1-9]\d{0,27}$/))
    .min(1)
    .max(MAX_NEIGHBOR_SELECTION),
})

export type NeighborSelectionInput = z.infer<typeof NeighborSelection>

export type NeighborPreviewParcel = VerifiedParcel & {
  alreadyWatchedId: string | null
}

export type NeighborPreview = {
  parcels: NeighborPreviewParcel[]
  total: number
  truncated: boolean
  unsupported: number
  dataAsOf: string | null
  availableSlots: number
  selectionLimit: number
  dailyLimit: number
}
