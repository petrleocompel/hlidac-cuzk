import { z } from 'zod'

export const auditPolicySchema = z.object({
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
})
