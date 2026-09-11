import {
  createFileRoute,
  Link,
  notFound,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/auth/client'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Badge } from '#/components/ui/badge'
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
import { Separator } from '#/components/ui/separator'
import {
  banUserAdmin,
  getUserAdmin,
  setUserPasswordAdmin,
  setUserRoleAdmin,
  unbanUserAdmin,
  updateUserAdmin,
} from '#/server/admin/users'

export const Route = createFileRoute('/admin/users/$userId')({
  loader: async ({ params }) => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    const detail = await getUserAdmin({ data: { userId: params.userId } })
    if (!detail) throw notFound()
    return { session, detail }
  },
  component: AdminUserDetailPage,
})

function AdminUserDetailPage() {
  const { session, detail } = Route.useLoaderData()
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const isSelf = detail.user.id === session.user.id

  async function run(action: () => Promise<void>, okMsg: string) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(okMsg)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mb-6">
        <Link
          to="/admin"
          search={{ page: 1 }}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Uživatelé
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {detail.user.name}
        </h1>
        <p className="text-sm text-muted-foreground">{detail.user.email}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge
            variant={detail.user.role === 'admin' ? 'default' : 'secondary'}
          >
            {detail.user.role ?? 'user'}
          </Badge>
          {detail.user.banned ? (
            <Badge variant="destructive">zabanován</Badge>
          ) : (
            <Badge variant="outline">aktivní</Badge>
          )}
          {detail.user.emailVerified ? (
            <Badge variant="secondary">e-mail ověřen</Badge>
          ) : (
            <Badge variant="outline">e-mail neověřen</Badge>
          )}
        </div>
      </div>

      {message ? <p className="mb-4 text-sm text-primary">{message}</p> : null}
      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Účet</CardTitle>
            <CardDescription>Jméno, e-mail, role a heslo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                void run(async () => {
                  await updateUserAdmin({
                    data: {
                      userId: detail.user.id,
                      name: String(fd.get('name') ?? ''),
                      email: String(fd.get('email') ?? ''),
                    },
                  })
                }, 'Účet uložen')
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Jméno</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={detail.user.name}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={detail.user.email}
                  required
                />
              </div>
              <Button type="submit" disabled={pending}>
                Uložit účet
              </Button>
            </form>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Role</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={detail.user.role === 'user' ? 'default' : 'outline'}
                  disabled={pending || isSelf || detail.user.role === 'user'}
                  onClick={() =>
                    void run(async () => {
                      await setUserRoleAdmin({
                        data: { userId: detail.user.id, role: 'user' },
                      })
                    }, 'Role nastavena na user')
                  }
                >
                  user
                </Button>
                <Button
                  type="button"
                  variant={detail.user.role === 'admin' ? 'default' : 'outline'}
                  disabled={pending || isSelf || detail.user.role === 'admin'}
                  onClick={() =>
                    void run(async () => {
                      await setUserRoleAdmin({
                        data: { userId: detail.user.id, role: 'admin' },
                      })
                    }, 'Role nastavena na admin')
                  }
                >
                  admin
                </Button>
              </div>
              {isSelf ? (
                <p className="text-xs text-muted-foreground">
                  Vlastní roli nelze měnit.
                </p>
              ) : null}
            </div>

            <Separator />

            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                const fd = new FormData(e.currentTarget)
                const password = String(fd.get('newPassword') ?? '')
                if (
                  !confirm(
                    'Nastavit nové heslo tomuto uživateli? Staré přestane fungovat.',
                  )
                ) {
                  return
                }
                void run(async () => {
                  await setUserPasswordAdmin({
                    data: { userId: detail.user.id, newPassword: password },
                  })
                  e.currentTarget.reset()
                }, 'Heslo změněno')
              }}
            >
              <p className="text-sm font-medium">Ruční reset hesla</p>
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nové heslo (min. 12 znaků)</Label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" variant="outline" disabled={pending}>
                Nastavit heslo
              </Button>
            </form>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Akce</p>
              <div className="flex flex-wrap gap-2">
                {!isSelf && !detail.user.banned ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      void impersonate(detail.user.id, detail.user.email)
                    }}
                  >
                    Impersonovat
                  </Button>
                ) : null}
                {!isSelf && !detail.user.banned ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      const reason = prompt('Důvod banu:')
                      if (!reason?.trim()) return
                      void run(async () => {
                        await banUserAdmin({
                          data: {
                            userId: detail.user.id,
                            reason: reason.trim(),
                          },
                        })
                      }, 'Uživatel zabanován')
                    }}
                  >
                    Ban
                  </Button>
                ) : null}
                {!isSelf && detail.user.banned ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void run(async () => {
                        await unbanUserAdmin({
                          data: { userId: detail.user.id },
                        })
                      }, 'Ban zrušen')
                    }
                  >
                    Zrušit ban
                  </Button>
                ) : null}
              </div>
              {detail.user.banReason ? (
                <p className="text-xs text-muted-foreground">
                  Důvod banu: {detail.user.banReason}
                </p>
              ) : null}
              <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt>ID</dt>
                  <dd className="font-mono text-foreground">
                    {detail.user.id}
                  </dd>
                </div>
                <div>
                  <dt>Vytvořen</dt>
                  <dd>
                    {new Date(detail.user.createdAt).toLocaleString('cs')}
                  </dd>
                </div>
                <div>
                  <dt>Upraven</dt>
                  <dd>
                    {new Date(detail.user.updatedAt).toLocaleString('cs')}
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notifikace</CardTitle>
              <CardDescription>Uložené kanály uživatele</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!detail.notifications ? (
                <p className="text-muted-foreground">Bez nastavení</p>
              ) : (
                <>
                  <p>
                    <span className="text-muted-foreground">Gotify: </span>
                    {detail.notifications.gotifyUrl ?? '—'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Discord: </span>
                    {detail.notifications.discordWebhookUrl ? 'nastaven' : '—'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Slack: </span>
                    {detail.notifications.slackWebhookUrl ? 'nastaven' : '—'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sledované parcely ({detail.watches.length})</CardTitle>
              <CardDescription>Objekty evidované uživatelem</CardDescription>
            </CardHeader>
            <CardContent>
              {detail.watches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné sledování</p>
              ) : (
                <ul className="space-y-3">
                  {detail.watches.map((w) => (
                    <li key={w.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{w.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {w.kuName} ({w.kuCode}) ·{' '}
                            {w.parcelSubdivision != null
                              ? `${w.parcelNumber}/${w.parcelSubdivision}`
                              : w.parcelNumber}{' '}
                            · ISKN {w.isknId}
                          </p>
                        </div>
                        <Badge variant={w.enabled ? 'secondary' : 'outline'}>
                          {w.enabled ? 'aktivní' : 'vypnuto'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Interval {w.pollIntervalMinutes} min
                        {w.lastSuccessfulCheckAt
                          ? ` · poslední úspěch ${new Date(w.lastSuccessfulCheckAt).toLocaleString('cs')}`
                          : ' · ještě nekontrolováno'}
                      </p>
                      {w.lastError ? (
                        <p className="mt-1 text-xs text-destructive">
                          {w.lastError}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardShell>
  )
}

async function impersonate(userId: string, email: string) {
  if (!confirm(`Přihlásit se jako ${email}?`)) return
  const res = await authClient.admin.impersonateUser({ userId })
  if (res.error) {
    alert(res.error.message ?? 'Impersonace selhala')
    return
  }
  window.location.href = '/dashboard'
}
