import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { getServerSession } from '#/auth/session'
import { authClient } from '#/auth/client'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { listUsersAdmin } from '#/server/admin/users'

const Search = z.object({
  search: z.string().optional(),
  role: z.enum(['user', 'admin']).optional(),
  banned: z.enum(['yes', 'no']).optional(),
  page: z.coerce.number().int().positive().default(1),
})

export const Route = createFileRoute('/admin/')({
  validateSearch: (s) => Search.parse(s),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    const page = await listUsersAdmin({ data: deps })
    return { session, page }
  },
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const { session, page } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize))

  function update(patch: Partial<z.infer<typeof Search>>) {
    void navigate({
      search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }),
    })
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

  return (
    <DashboardShell email={session.user.email} isAdmin>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Uživatelé ({page.total})
          </h1>
          <p className="text-sm text-muted-foreground">
            Role, impersonace, sledované parcely
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Hledat jméno / e-mail"
            className="w-56"
            defaultValue={search.search ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                update({
                  search: (e.target as HTMLInputElement).value || undefined,
                })
              }
            }}
          />
          <select
            className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={search.role ?? ''}
            onChange={(e) =>
              update({
                role: (e.target.value || undefined) as 'user' | 'admin' | undefined,
              })
            }
          >
            <option value="">Všechny role</option>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <select
            className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={search.banned ?? ''}
            onChange={(e) =>
              update({
                banned: (e.target.value || undefined) as 'yes' | 'no' | undefined,
              })
            }
          >
            <option value="">Ban: vše</option>
            <option value="yes">zabanovaní</option>
            <option value="no">aktivní</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Jméno</th>
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Parcely</th>
              <th className="px-3 py-2 font-medium">Stav</th>
              <th className="px-3 py-2 font-medium">Vytvořen</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {page.users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2 font-medium">{u.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                    {u.role ?? 'user'}
                  </Badge>
                </td>
                <td className="px-3 py-2">{u.watchCount}</td>
                <td className="px-3 py-2">
                  {u.banned ? (
                    <Badge variant="destructive">ban</Badge>
                  ) : (
                    <Badge variant="outline">ok</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleString('cs')}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: u.id }}
                      >
                        Detail
                      </Link>
                    </Button>
                    {u.id !== session.user.id && !u.banned ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void impersonate(u.id, u.email)}
                      >
                        Impersonovat
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {page.users.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Žádní uživatelé
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page.page <= 1}
            onClick={() => update({ page: page.page - 1 })}
          >
            Předchozí
          </Button>
          <span className="text-muted-foreground">
            Strana {page.page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page.page >= totalPages}
            onClick={() => update({ page: page.page + 1 })}
          >
            Další
          </Button>
        </div>
      ) : null}
    </DashboardShell>
  )
}
