import { retentionSchema } from './lib/maintenance/policy'
import { normalizeGotifyUrl } from './lib/notifications/destinations'
import { z } from 'zod'
import { policySchema } from './auth/policy'
import { cuzkPolicySchema } from './lib/cuzk/policy'

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())
const url = z
  .url()
  .refine(
    (value) =>
      URL.canParse(value) &&
      ['http:', 'https:'].includes(new URL(value).protocol),
    'Použijte HTTP/HTTPS URL.',
  )
/** Canonical 32-byte key as standard base64 (works without Node Buffer). */
function isCanonicalSecretKey(value: string): boolean {
  try {
    const binary = atob(value)
    if (binary.length !== 32) return false
    return btoa(binary) === value
  } catch {
    return false
  }
}
const secretKey = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/)
  .refine(isCanonicalSecretKey)
const baseSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) &&
          ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
        'Použijte PostgreSQL URL.',
      ),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: url.refine((value) => {
      if (!URL.canParse(value)) return false
      const parsed = new URL(value)
      return (
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        parsed.pathname === '/'
      )
    }, 'Použijte veřejný origin bez cesty nebo přihlašovacích údajů.'),
    ADMIN_EMAIL: optional(z.email()),
    ADMIN_PASSWORD: optional(z.string().min(12).max(200)),
    ADMIN_NAME: z.string().optional(),
    SEED_DEMO_WATCH: z.enum(['0', '1']).default('0'),
    CUZK_API_KEY: z.string().trim().min(1),
    CUZK_API_BASE_URL: url.default('https://api-kn.cuzk.gov.cz'),
    // Public RÚIAN address service; no API key and outside the KN budget.
    RUIAN_GEOCODE_URL: url.default(
      'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer',
    ),
    NOTIFICATION_ENCRYPTION_KEY: optional(secretKey),
    NOTIFICATION_PREVIOUS_ENCRYPTION_KEY: optional(secretKey),
    METRICS_BEARER_TOKEN: optional(z.string().min(32)),
    SMTP_URL: optional(
      z
        .string()
        .url()
        .refine(
          (value) => ['smtp:', 'smtps:'].includes(new URL(value).protocol),
          'Použijte smtp:// nebo smtps:// URL.',
        ),
    ),
    SMTP_FROM: optional(
      z
        .string()
        .min(1)
        .refine(
          (value) => !/[\r\n]/.test(value),
          'Adresa odesílatele musí být na jednom řádku.',
        ),
    ),
    NTFY_ALLOWED_URLS: z
      .string()
      .default('')
      .refine((value) => {
        try {
          value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .forEach(normalizeGotifyUrl)
          return true
        } catch {
          return false
        }
      }, 'Použijte platné základní HTTP/HTTPS URL.'),
    SENTRY_DSN: optional(url),
    SENTRY_ENVIRONMENT: z.string().optional(),
    SENTRY_RELEASE: z.string().optional(),
    SSO_BOOTSTRAP_ENABLED: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .default('false'),
    SSO_BOOTSTRAP_PROVIDER_ID: optional(z.string().regex(/^[A-Za-z0-9_-]+$/)),
    SSO_BOOTSTRAP_ISSUER: optional(url),
    SSO_BOOTSTRAP_CLIENT_ID: optional(z.string().min(1)),
    SSO_BOOTSTRAP_CLIENT_SECRET: optional(z.string().min(1)),
    SSO_BOOTSTRAP_LABEL: z.string().optional(),
    SSO_BOOTSTRAP_DOMAIN: z.string().optional(),
    GOTIFY_ALLOWED_URLS: z
      .string()
      .default('')
      .refine((value) => {
        try {
          value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .forEach(normalizeGotifyUrl)
          return true
        } catch {
          return false
        }
      }, 'Použijte čárkou oddělené HTTP/HTTPS základní URL bez přihlašovacích údajů.'),
  })
  .extend(policySchema.shape)
  .extend(cuzkPolicySchema.shape)
  .extend(retentionSchema.shape)
  .superRefine((values, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })
    if (Boolean(values.SMTP_URL) !== Boolean(values.SMTP_FROM))
      issue('SMTP_URL', 'SMTP_URL a SMTP_FROM nastavte společně.')
    if (['true', '1', 'yes', 'on'].includes(values.SSO_BOOTSTRAP_ENABLED)) {
      for (const field of [
        'SSO_BOOTSTRAP_PROVIDER_ID',
        'SSO_BOOTSTRAP_ISSUER',
        'SSO_BOOTSTRAP_CLIENT_ID',
        'SSO_BOOTSTRAP_CLIENT_SECRET',
      ] as const)
        if (!values[field]) issue(field, 'Povinné při zapnutém SSO bootstrapu.')
    }
    if (
      values.AUTH_TRUST_PROXY_HEADERS === 'true' &&
      !values.AUTH_TRUSTED_PROXIES.trim()
    )
      issue(
        'AUTH_TRUSTED_PROXIES',
        'Vyjmenujte důvěryhodné proxy při zapnutých forwarding hlavičkách.',
      )
    if (values.NODE_ENV === 'production') {
      if (/replace-with|change-me|^secret$/.test(values.BETTER_AUTH_SECRET))
        issue(
          'BETTER_AUTH_SECRET',
          'Nahraďte vzor skutečným náhodným tajným klíčem.',
        )
      const password = URL.canParse(values.DATABASE_URL)
        ? new URL(values.DATABASE_URL).password
        : ''
      if (['hlidac', 'change-me', 'password', 'postgres'].includes(password))
        issue('DATABASE_URL', 'Nahraďte ukázkové heslo databáze.')
    }
  })

export type Env = z.infer<typeof baseSchema>
export class ConfigurationError extends Error {}

/** No caching: commands/tests may change env; errors contain names and rules, never values. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = baseSchema.safeParse({
    ...source,
    BETTER_AUTH_URL:
      source.BETTER_AUTH_URL ||
      source.PUBLIC_URL ||
      (source.NODE_ENV !== 'production' ? 'http://127.0.0.1:3000' : undefined),
  })
  if (!result.success)
    throw new ConfigurationError(
      'Neplatná konfigurace: ' +
        result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
    )
  return result.data
}
