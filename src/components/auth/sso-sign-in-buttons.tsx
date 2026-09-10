import { useEffect, useState } from 'react'
import { authClient } from '#/auth/client'
import { Button } from '#/components/ui/button'
import { listPublicSsoProviders } from '#/server/sso/public'
import type { PublicSsoProvider } from '#/server/sso/public'

export function SsoSignInButtons({
  callbackURL = '/dashboard',
}: {
  callbackURL?: string
}) {
  const [providers, setProviders] = useState<PublicSsoProvider[]>([])
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listPublicSsoProviders()
      .then((rows) => {
        if (!cancelled) setProviders(rows)
      })
      .catch(() => {
        if (!cancelled) setProviders([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (providers.length === 0) return null

  async function signIn(providerId: string) {
    setPendingId(providerId)
    setError(null)
    const { data, error: err } = await authClient.signIn.sso({
      providerId,
      callbackURL,
    })
    setPendingId(null)
    if (err) {
      setError(err.message ?? 'SSO přihlášení selhalo')
      return
    }
    if (typeof data.url === 'string') {
      window.location.href = data.url
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="bg-card px-2">nebo SSO</span>
        <div className="absolute inset-x-0 top-1/2 -z-10 border-t border-border" />
      </div>
      {providers.map((p) => (
        <Button
          key={p.providerId}
          type="button"
          variant="outline"
          className="w-full"
          disabled={pendingId !== null}
          onClick={() => void signIn(p.providerId)}
        >
          {pendingId === p.providerId
            ? 'Přesměrovávám…'
            : `Pokračovat přes ${p.name}`}
        </Button>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
