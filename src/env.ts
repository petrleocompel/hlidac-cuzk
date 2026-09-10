import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default('http://127.0.0.1:3000'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  ADMIN_NAME: z.string().optional(),
  CUZK_API_KEY: z.string().min(1),
  CUZK_API_BASE_URL: z
    .string()
    .url()
    .default('https://api-kn.cuzk.gov.cz'),
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  GOTIFY_URL: z.string().optional().default(''),
  GOTIFY_TOKEN: z.string().optional().default(''),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  cached = envSchema.parse(process.env)
  return cached
}

/** Lazy proxy so importing modules does not crash during client bundling. */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    return getEnv()[prop as keyof Env]
  },
})
