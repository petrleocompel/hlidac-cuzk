import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { BulkWatchInput, OrganizationInput } from '#/lib/watch-organization'

export const saveOrganization = createServerFn({ method: 'POST' })
  .inputValidator((v) => OrganizationInput.parse(v))
  .handler(async ({ data }) => {
    const session = await requireSession()
    const { saveWatchOrganization } = await import('./organization.server')
    return saveWatchOrganization(session.user.id, data)
  })
export const bulkUpdateWatches = createServerFn({ method: 'POST' })
  .inputValidator((v) => BulkWatchInput.parse(v))
  .handler(async ({ data }) => {
    const session = await requireSession()
    const { changeWatchBatch } = await import('./organization.server')
    return changeWatchBatch(session.user.id, data)
  })
