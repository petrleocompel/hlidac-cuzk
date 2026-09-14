import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAdmin } from '#/auth/session'
import { readAudit } from '#/lib/audit/list'

const Input = z.object({
  before: z.object({ at: z.iso.datetime(), id: z.uuid() }).optional(),
})
export const listAuditAdmin = createServerFn({ method: 'GET' })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }) => {
    await requireAdmin()
    return readAudit(data.before)
  })
