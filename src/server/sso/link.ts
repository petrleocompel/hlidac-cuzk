import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export const startSsoLink = createServerFn({ method: 'POST' })
  .inputValidator((d) =>
    z
      .object({
        providerId: z.string().min(1),
        callbackURL: z.string().default('/dashboard/account'),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { startSsoLinkForUser } = await import('./link.server')
    return startSsoLinkForUser(data)
  })
