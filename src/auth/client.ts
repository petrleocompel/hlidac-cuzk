import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'

export const authClient = createAuthClient({
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'),
  plugins: [adminClient(), ssoClient()],
})

export const { useSession } = authClient
