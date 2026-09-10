import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
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

export const Route = createFileRoute('/dashboard/account')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session }
  },
  component: AccountPage,
})

function AccountPage() {
  const { session } = Route.useLoaderData()
  const [name, setName] = useState(session.user.name)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profilePending, setProfilePending] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordPending, setPasswordPending] = useState(false)

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

  return (
    <DashboardShell
      user={session.user}
      isAdmin={session.user.role === 'admin'}
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Účet</h1>
          <p className="text-sm text-muted-foreground">
            Správa profilu a hesla
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
