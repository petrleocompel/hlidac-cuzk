import { useState } from 'react'
import { authClient, useSession } from '#/auth/client'
import { Button } from '#/components/ui/button'

/**
 * Amber bar while an admin is impersonating another user
 * (better-auth sets session.impersonatedBy).
 */
export function ImpersonationBanner() {
  const { data } = useSession()
  const [busy, setBusy] = useState(false)

  const impersonatedBy = (
    data?.session as { impersonatedBy?: string | null } | undefined
  )?.impersonatedBy
  if (!impersonatedBy || !data) return null

  async function onStop() {
    setBusy(true)
    try {
      await authClient.admin.stopImpersonating()
      window.location.href = '/admin'
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950">
      <span>
        Impersonace: jste přihlášeni jako{' '}
        <strong>{data.user.email}</strong>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        className="h-7 border-amber-400 bg-amber-50"
        onClick={() => void onStop()}
      >
        {busy ? 'Ukončuji…' : 'Ukončit impersonaci'}
      </Button>
    </div>
  )
}
