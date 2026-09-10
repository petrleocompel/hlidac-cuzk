import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
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
import {
  createSsoProviderAdmin,
  deleteSsoProviderAdmin,
  listSsoProvidersAdmin,
  updateSsoProviderAdmin,
} from '#/server/sso/admin'
import type { AdminSsoProvider } from '#/server/sso/admin'
import { ssoLinkCallbackUrl } from '#/lib/sso'
import type { SsoDomainMode } from '#/lib/sso'

export const Route = createFileRoute('/admin/sso')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    const providers = await listSsoProvidersAdmin()
    const base = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'
    return {
      session,
      providers,
      linkCallbackUrl: ssoLinkCallbackUrl(base),
    }
  },
  component: AdminSsoPage,
})

type FormState = {
  id?: string
  providerId: string
  name: string
  issuer: string
  clientId: string
  clientSecret: string
  domainMode: SsoDomainMode
  domain: string
}

const emptyForm: FormState = {
  providerId: '',
  name: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  domainMode: 'any',
  domain: '',
}

function AdminSsoPage() {
  const { session, providers: initial, linkCallbackUrl } = Route.useLoaderData()
  const [providers, setProviders] = useState(initial)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function edit(p: AdminSsoProvider) {
    setForm({
      id: p.id,
      providerId: p.providerId,
      name: p.name ?? '',
      issuer: p.issuer,
      clientId: p.clientId,
      clientSecret: '',
      domainMode: p.domainMode,
      domain: p.domain,
    })
    setError(null)
  }

  async function refresh() {
    setProviders(await listSsoProvidersAdmin())
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const payload = {
        providerId: form.providerId,
        name: form.name || undefined,
        issuer: form.issuer,
        clientId: form.clientId,
        clientSecret: form.clientSecret || undefined,
        domainMode: form.domainMode,
        domain: form.domain || undefined,
      }
      if (form.id) {
        await updateSsoProviderAdmin({ data: { ...payload, id: form.id } })
      } else {
        await createSsoProviderAdmin({ data: payload })
      }
      setForm(emptyForm)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uložení selhalo')
    } finally {
      setPending(false)
    }
  }

  async function onDelete(p: AdminSsoProvider) {
    if (!confirm(`Smazat IdP „${p.name || p.providerId}“?`)) return
    setPending(true)
    setError(null)
    try {
      await deleteSsoProviderAdmin({ data: { id: p.id } })
      if (form.id === p.id) setForm(emptyForm)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smazání selhalo')
    } finally {
      setPending(false)
    }
  }

  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SSO / OIDC</h1>
          <p className="text-sm text-muted-foreground">
            Identity providery (Authentik, Keycloak, …). Heslo zůstává vždy
            dostupné. Doména výchozí:{' '}
            <span className="font-medium text-foreground">any</span>.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Registrované IdP</CardTitle>
            <CardDescription>
              Callback URL přidejte do IdP. Pro propojení účtu i link callback.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádný provider</p>
            ) : (
              <ul className="space-y-3">
                {providers.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-col gap-2 border-b border-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="font-medium">
                        {p.name || p.providerId}{' '}
                        <span className="text-muted-foreground">
                          ({p.providerId})
                        </span>
                      </p>
                      <p className="truncate text-muted-foreground">{p.issuer}</p>
                      <p className="text-xs text-muted-foreground">
                        Doména:{' '}
                        {p.domainMode === 'any' ? 'any' : p.domain || '—'}
                      </p>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {p.callbackUrl}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => edit(p)}
                      >
                        Upravit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => void onDelete(p)}
                      >
                        Smazat
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="break-all font-mono text-xs text-muted-foreground">
              Link callback: {linkCallbackUrl}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{form.id ? 'Upravit IdP' : 'Přidat IdP'}</CardTitle>
            <CardDescription>
              OIDC discovery z issuer URL. Client secret se při úpravě nevyplňuje,
              pokud se nemění.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="providerId">providerId</Label>
                  <Input
                    id="providerId"
                    value={form.providerId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, providerId: e.target.value }))
                    }
                    placeholder="authentik"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Popisek</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="Authentik"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="issuer">Issuer URL</Label>
                <Input
                  id="issuer"
                  type="url"
                  value={form.issuer}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, issuer: e.target.value }))
                  }
                  placeholder="https://auth.example.com/application/o/hlidac/"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="clientId">Client ID</Label>
                  <Input
                    id="clientId"
                    value={form.clientId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, clientId: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientSecret">Client secret</Label>
                  <Input
                    id="clientSecret"
                    type="password"
                    value={form.clientSecret}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, clientSecret: e.target.value }))
                    }
                    placeholder={form.id ? '(beze změny)' : undefined}
                    required={!form.id}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="domainMode">Doména</Label>
                <select
                  id="domainMode"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.domainMode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      domainMode: e.target.value as SsoDomainMode,
                    }))
                  }
                >
                  <option value="any">any — všichni uživatelé IdP</option>
                  <option value="specific">
                    specific — jen vybrané e-mailové domény
                  </option>
                </select>
              </div>
              {form.domainMode === 'specific' ? (
                <div className="space-y-2">
                  <Label htmlFor="domain">E-mailové domény</Label>
                  <Input
                    id="domain"
                    value={form.domain}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, domain: e.target.value }))
                    }
                    placeholder="firma.cz, dcerka.cz"
                    required
                  />
                </div>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Ukládám…' : form.id ? 'Uložit změny' : 'Přidat'}
                </Button>
                {form.id ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm(emptyForm)}
                  >
                    Zrušit úpravu
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" asChild>
                  <Link to="/admin" search={{ page: 1 }}>
                    Zpět na uživatele
                  </Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
