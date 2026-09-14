import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import {
  LinkInput,
  linkWatches,
  readWatchLinks,
  unlinkWatches,
} from '#/lib/watches/links'

export const getWatchLinks = createServerFn({ method: 'GET' })
  .inputValidator((d) => z.object({ id: z.uuid() }).parse(d))
  .handler(async ({ data }) =>
    readWatchLinks((await requireSession()).user.id, data.id),
  )
export const addWatchLink = createServerFn({ method: 'POST' })
  .inputValidator((d) => LinkInput.parse(d))
  .handler(async ({ data }) =>
    linkWatches((await requireSession()).user.id, data),
  )
export const removeWatchLink = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({ id: z.uuid() }).parse(d))
  .handler(async ({ data }) =>
    unlinkWatches((await requireSession()).user.id, data.id),
  )
