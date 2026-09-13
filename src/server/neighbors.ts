import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import {
  addSelectedNeighbors,
  NeighborSelection,
  previewNeighbors,
} from '#/lib/cuzk/neighbors'

export const getNeighbors = createServerFn({ method: 'POST' })
  .inputValidator((value) =>
    z.object({ watchId: z.string().uuid() }).parse(value),
  )
  .handler(async ({ data }) =>
    previewNeighbors((await requireSession()).user.id, data.watchId),
  )

export const addNeighbors = createServerFn({ method: 'POST' })
  .inputValidator((value) => NeighborSelection.parse(value))
  .handler(async ({ data }) =>
    addSelectedNeighbors((await requireSession()).user.id, data),
  )
