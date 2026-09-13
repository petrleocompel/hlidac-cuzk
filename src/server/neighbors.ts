import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { NeighborSelection } from '#/lib/cuzk/neighbor-types'

export const getNeighbors = createServerFn({ method: 'POST' })
  .inputValidator((value) =>
    z.object({ watchId: z.string().uuid() }).parse(value),
  )
  .handler(async ({ data }) => {
    const { requireSession } = await import('#/auth/session')
    const { previewNeighbors } = await import('#/lib/cuzk/neighbors.server')
    return previewNeighbors((await requireSession()).user.id, data.watchId)
  })

export const addNeighbors = createServerFn({ method: 'POST' })
  .inputValidator((value) => NeighborSelection.parse(value))
  .handler(async ({ data }) => {
    const { requireSession } = await import('#/auth/session')
    const { addSelectedNeighbors } = await import('#/lib/cuzk/neighbors.server')
    return addSelectedNeighbors((await requireSession()).user.id, data)
  })
