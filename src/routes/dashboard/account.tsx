import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { authClient } from '#/auth/client'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { listPublicSsoProviders } from '#/server/sso/public'
import type { PublicSsoProvider } from '#/server/sso/public'
import { startSsoLink } from '#/server/sso/link'

const Search = z.object({
  ssoLink: z.string().optional(),
  ssoLinkError: z.string().optional(),
})

export const Route = createFileRoute('/dashboard/account')({
  validateSearch: (s) => Search.parse(s),
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const ssoProviders = await listPublicSsoProviders()
    return { session, ssoProviders }
  },
  component: AccountPage,
})

type LinkedAccount = {
  id: string
  providerId: string
  accountId: string
}

function AccountPage() {
  const { session, ssoProviders } = Route.useLoaderData()
  const search = Route.useSearch()
  const [name, setName] = useState(session.user.name)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profilePending, setProfilePending] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordPending, setPasswordPending] = useState(false)

  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [linkPending, setLinkPending] = useState<string | null>(null)
  const [linkMsg, setLinkMsg] = useState<string | null>(
    search.ssoLink === 'ok' ? 'SSO účet propojen' : null,
  )
  const [linkError, setLinkError] = useState<string | null>(
    search.ssoLinkError
      ? `Propojení SSO selhalo (${search.ssoLinkError})`
      : null,
  )

  async function refreshAccounts() {
    const { data, error } = await authClient.listAccounts()
    if (error) {
      setAccountsError(error.message ?? 'Načtení účtů selhalo')
      return
    }
    setAccounts(
      data.map((a) => ({
        id: a.id,
        providerId: a.providerId,
        accountId: a.accountId,
      })),
    )
  }

  useEffect(() => {
    void refreshAccounts()
  }, [])

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfilePending(true)
    setProfileMsg(null)
    setProfileError(null)
    const { error } = await authClient.updateUser({ name: name.trim() })
    setProfilePending(false)
    if (error) {
      setProfileError(error.message ?? 'Uložení profilu selhalo')
      return
    }
    setProfileMsg('Profil uložen')
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordPending(true)
    setPasswordMsg(null)
    setPasswordError(null)
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    setPasswordPending(false)
    if (error) {
      setPasswordError(error.message ?? 'Změna hesla selhala')
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setPasswordMsg('Heslo změněno')
  }

  async function onUnlink(providerId: string) {
    if (!confirm(`Odpojit ${providerId}?`)) return
    setAccountsError(null)
    const { error } = await authClient.unlinkAccount({ providerId })
    if (error) {
      setAccountsError(error.message ?? 'Odpojení selhalo')
      return
    }
    await refreshAccounts()
  }

  async function onLink(provider: PublicSsoProvider) {
    setLinkPending(provider.providerId)
    setLinkError(null)
    setLinkMsg(null)
    try {
      const { url } = await startSsoLink({
        data: {
          providerId: provider.providerId,
          callbackURL: '/dashboard/account',
        },
      })
      window.location.href = url
    } catch (err) {
      setLinkPending(null)
      setLinkError(err instanceof Error ? err.message : 'Propojení selhalo')
    }
  }

  const linkedProviderIds = new Set(accounts.map((a) => a.providerId))
  const linkable = ssoProviders.filter((p) => !linkedProviderIds.has(p.providerId))
  const hasCredential = accounts.some((a) => a.providerId === 'credential')

  function providerLabel(providerId: string) {
    if (providerId === 'credential') return 'E-mail a heslo'
    return (
      ssoProviders.find((p) => p.providerId === providerId)?.name ?? providerId
    )
  }

  return (
    <DashboardShell
      user={session.user}
      isAdmin={session.user.role === 'admin'}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Účet</h1>
          <p className="text-sm text-muted-foreground">
            Správa profilu, hesla a SSO
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>Jméno a e-mail přihlášeného uživatele</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSaveProfile}>
              <div className="space-y-2">
                <Label htmlFor="name">Jméno</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  value={session.user.email}
                  disabled
                  readOnly
                />
              </div>
              {profileError ? (
                <p className="text-sm text-destructive">{profileError}</p>
              ) : null}
              {profileMsg ? (
                <p className="text-sm text-muted-foreground">{profileMsg}</p>
              ) : null}
              <Button type="submit" disabled={profilePending}>
                {profilePending ? 'Ukládám…' : 'Uložit profil'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Přihlášení</CardTitle>
            <CardDescription>
              Propojené identity. SSO se nepropojuje automaticky při přihlášení —
              jen explicitně zde (stejný e-mail).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm">
              {accounts.length === 0 ? (
                <li className="text-muted-foreground">Načítám…</li>
              ) : (
                accounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                  >
                    <span>{providerLabel(a.providerId)}</span>
                    {a.providerId !== 'credential' ||
                    accounts.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          a.providerId === 'credential' &&
                          accounts.length === 1
                        }
                        onClick={() => void onUnlink(a.providerId)}
                      >
                        Odpojit
                      </Button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {linkable.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Propojit SSO</p>
                {linkable.map((p) => (
                  <Button
                    key={p.providerId}
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={linkPending !== null}
                    onClick={() => void onLink(p)}
                  >
                    {linkPending === p.providerId
                      ? 'Přesměrovávám…'
                      : `Propojit ${p.name}`}
                  </Button>
                ))}
              </div>
            ) : null}
            {!hasCredential ? (
              <p className="text-xs text-muted-foreground">
                Účet nemá heslo — nastavte ho níže, pokud chcete odpojit SSO.
              </p>
            ) : null}
            {accountsError ? (
              <p className="text-sm text-destructive">{accountsError}</p>
            ) : null}
            {linkError ? (
              <p className="text-sm text-destructive">{linkError}</p>
            ) : null}
            {linkMsg ? (
              <p className="text-sm text-muted-foreground">{linkMsg}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heslo</CardTitle>
            <CardDescription>
              Po změně hesla budou ostatní relace odhlášeny
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onChangePassword}>
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Současné heslo</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nové heslo</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              {passwordError ? (
                <p className="text-sm text-destructive">{passwordError}</p>
              ) : null}
              {passwordMsg ? (
                <p className="text-sm text-muted-foreground">{passwordMsg}</p>
              ) : null}
              <Button type="submit" disabled={passwordPending}>
                {passwordPending ? 'Měním…' : 'Změnit heslo'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
