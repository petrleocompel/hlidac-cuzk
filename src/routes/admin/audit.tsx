import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { listAuditAdmin } from '#/server/admin/audit'

export const Route = createFileRoute('/admin/audit')({
  validateSearch: z.object({
    at: z.iso.datetime().optional(),
    id: z.uuid().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return {
      session,
      audit: await listAuditAdmin({
        data: {
          before: deps.at && deps.id ? { at: deps.at, id: deps.id } : undefined,
        },
      }),
    }
  },
  component: AuditPage,
})
const labels: Record<string, string> = {
  'user.deleted': 'Smazání účtu',
  'user.role_changed': 'Změna role',
  'user.ban_changed': 'Změna blokace',
  'sso.insert': 'Přidání SSO',
  'sso.update': 'Změna SSO',
  'sso.delete': 'Smazání SSO',
  'impersonation.started': 'Začátek impersonace',
  'impersonation.session_removed': 'Odstranění relace impersonace',
  'password.changed': 'Změna hesla',
}
function AuditPage() {
  const { session, audit } = Route.useLoaderData()
  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto w-full max-w-5xl min-w-0 space-y-4">
        <h1 className="text-2xl font-semibold">Audit správy</h1>
        <p>
          Záznamy se uchovávají {audit.days} dnů. Worker je po uplynutí retence
          odstraňuje po dávkách. Identifikátory zůstávají zachované i po smazání
          účtu.
        </p>
        <p className="text-sm text-muted-foreground">
          Neznámý původce znamená změnu bez ověřené webové relace, například
          přímý zásah do databáze. Odstranění relace nemusí znamenat ruční
          ukončení impersonace.
        </p>
        <ol className="space-y-3" aria-label="Záznamy auditu">
          {audit.items.map((item) => (
            <li
              key={item.id}
              className="space-y-1 rounded-lg border p-3 break-words"
            >
              <p className="font-medium">
                {labels[item.action] ?? item.action}
              </p>
              <p>
                <time dateTime={item.createdAt}>{item.createdAt}</time>
              </p>
              <p>
                Původce:{' '}
                {item.actorId === 'local-cli'
                  ? 'Lokální správce (CLI)'
                  : (item.actorId ?? 'Neznámý / systém')}
              </p>
              <p>Cíl: {item.targetId}</p>
              <details>
                <summary className="cursor-pointer">Podrobnosti změny</summary>
                <pre className="whitespace-pre-wrap break-all text-sm">
                  {item.details}
                </pre>
              </details>
            </li>
          ))}
        </ol>
        {!audit.items.length && <p>Žádné záznamy.</p>}
        <nav className="flex flex-wrap gap-4" aria-label="Stránky auditu">
          <Link to="/admin/audit" search={{}} className="underline">
            Nejnovější
          </Link>
          {audit.next && (
            <Link to="/admin/audit" search={audit.next} className="underline">
              Starší záznamy
            </Link>
          )}
        </nav>
      </div>
    </DashboardShell>
  )
}
