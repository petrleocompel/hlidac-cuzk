import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  createAccountAdmin,
  createInvitationAdmin,
  getAccessAdmin,
  revokeInvitationAdmin,
} from '#/server/admin/access'
import { formatCheckTime } from '#/lib/monitoring/freshness'

export const Route = createFileRoute('/admin/access')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session, access: await getAccessAdmin() }
  },
  component: AccessPage,
})
function AccessPage() {
  const { session, access } = Route.useLoaderData()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [action, setAction] = useState('invite')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [token, setToken] = useState('')
  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5">
        <h1 className="text-2xl font-semibold">Přístup a pozvánky</h1>
        <p>
          Registrace: {access.registrationMode} · nové účty přes SSO:{' '}
          {access.ssoRegistrationMode} · přihlašování: {access.authMode}
        </p>
        <p className="text-sm text-muted-foreground">
          Výchozí soukromý režim dovoluje založit účet správci. Pozvánky se
          uplatní při zapnutém režimu invite; konfiguraci instance mění
          provozovatel.
        </p>
        <form
          className="space-y-4 rounded-xl border bg-card p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setMessage('')
            setToken('')
            try {
              if (action === 'invite') {
                const result = await createInvitationAdmin({ data: { email } })
                setToken(result.token)
                setMessage(
                  `Pozvánka platí do ${formatCheckTime(result.expiresAt)}. Kód předejte pozvanému; zobrazí se pouze nyní.`,
                )
              } else {
                await createAccountAdmin({ data: { email, name, password } })
                setPassword('')
                setMessage('Uživatelský účet byl vytvořen.')
              }
              await router.invalidate()
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Uložení selhalo.',
              )
            } finally {
              setPending(false)
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="access-action">Akce</Label>
            <select
              id="access-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3"
            >
              <option value="invite">Vystavit pozvánku</option>
              <option value="account">Vytvořit uživatelský účet</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          {action === 'account' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="account-name">Jméno</Label>
                <Input
                  id="account-name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-password">
                  Počáteční heslo (min. 12 znaků)
                </Label>
                <Input
                  id="account-password"
                  type="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </>
          )}
          <Button disabled={pending} type="submit">
            {pending
              ? 'Ukládám…'
              : action === 'invite'
                ? 'Vystavit pozvánku'
                : 'Vytvořit účet'}
          </Button>
        </form>
        <p role="status" className="text-sm">
          {message}
        </p>
        {token && (
          <div className="space-y-2">
            <Label htmlFor="invitation-code">Jednorázový kód pozvánky</Label>
            <Input
              id="invitation-code"
              value={token}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <p className="text-sm text-muted-foreground">
              Pozvaný zadá tento kód a stejný e-mail při registraci. Odeslání
              e-mailu není automatické. Pro pozvané přes SSO musí poskytovatel
              potvrdit e-mail.
            </p>
          </div>
        )}
        <ul className="space-y-3" aria-label="Posledních 100 pozvánek">
          {access.invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div>
                <p>{invitation.email}</p>
                <p className="text-sm text-muted-foreground">
                  {invitation.usedAt
                    ? 'Použitá'
                    : invitation.revokedAt
                      ? 'Zrušená'
                      : 'Nevyužitá'}{' '}
                  · platnost do {formatCheckTime(invitation.expiresAt)}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={
                  pending || !!invitation.usedAt || !!invitation.revokedAt
                }
                onClick={async () => {
                  setPending(true)
                  try {
                    await revokeInvitationAdmin({ data: { id: invitation.id } })
                    await router.invalidate()
                    setMessage('Pozvánka zrušena.')
                  } catch {
                    setMessage('Zrušení se nezdařilo.')
                  } finally {
                    setPending(false)
                  }
                }}
              >
                Zrušit pozvánku
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </DashboardShell>
  )
}
