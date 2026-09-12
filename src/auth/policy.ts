import { z } from 'zod'

export const policySchema = z.object({
  REGISTRATION_MODE: z.enum(['private', 'invite', 'open']).default('private'),
  SSO_REGISTRATION_MODE: z
    .enum(['existing', 'invite', 'open'])
    .default('existing'),
  AUTH_MODE: z.enum(['hybrid', 'sso']).default('hybrid'),
  AUTH_TRUST_PROXY_HEADERS: z.enum(['true', 'false']).default('false'),
  AUTH_TRUSTED_PROXIES: z.string().default(''),
})
export function authPolicy() {
  return policySchema.parse(process.env)
}
export const MIN_PASSWORD_LENGTH = 12
