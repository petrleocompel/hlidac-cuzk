import { createServerFn } from '@tanstack/react-start'
import { db } from '#/db'
import { ensureDbReady } from '#/db/migrate'
import { ssoProvider } from '#/db/schema'

export type PublicSsoProvider = {
  providerId: string
  name: string
}

export const listPublicSsoProviders = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicSsoProvider[]> => {
    await ensureDbReady()
    const rows = await db
      .select({
        providerId: ssoProvider.providerId,
        name: ssoProvider.name,
      })
      .from(ssoProvider)

    return rows.map((row) => ({
      providerId: row.providerId,
      name: row.name?.trim() || row.providerId,
    }))
  },
)
