import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { formatCheckTime } from '#/lib/monitoring/freshness'
import { getPortfolio } from '#/server/portfolio'

export const Route = createFileRoute('/dashboard/portfolio')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session, groups: await getPortfolio() }
  },
  component: PortfolioPage,
})
function PortfolioPage() {
  const { session, groups } = Route.useLoaderData()
  return (
    <DashboardShell user={session.user} isAdmin={session.user.role === 'admin'}>
      <h1 className="text-2xl font-semibold">Sledované objekty na LV</h1>
      <p className="text-sm text-muted-foreground">
        Přehled obsahuje pouze vámi přidané objekty podle posledních získaných
        údajů. Není úplným seznamem nemovitostí na LV a nové objekty automaticky
        neobjeví. Změna LV sama nepotvrzuje změnu vlastníka.
      </p>
      {!groups.length ? (
        <p>
          Zatím nemáte sledované objekty.{' '}
          <Link to="/dashboard/watches/new" className="underline">
            Přidat parcelu
          </Link>
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} className="space-y-4 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">
            {group.lvNumber != null ? `LV ${group.lvNumber}` : 'Bez známého LV'}{' '}
            · {group.kuName} ({group.kuCode})
          </h2>
          <p className="text-sm">
            Sledovaných objektů: {group.watches.length}
            {group.lvNumber == null
              ? '. Společný LV těchto objektů není známý.'
              : ''}
          </p>
          <ul className="space-y-2">
            {group.watches.map((watch) => (
              <li key={watch.id}>
                <Link
                  className="font-medium underline"
                  to="/dashboard/watches/$id"
                  params={{ id: watch.id }}
                >
                  {watch.label}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {watch.enabled ? 'Aktivní' : 'Pozastaveno'} · poslední úspěch{' '}
                  {formatCheckTime(watch.lastSuccessfulCheckAt)}
                  {watch.lastError
                    ? ' · kontrola hlásí chybu, zobrazeny poslední známé údaje'
                    : ''}
                </p>
              </li>
            ))}
          </ul>
          <h3 className="font-medium">Poslední události těchto sledování</h3>
          <p className="text-xs text-muted-foreground">
            Nejvýše deset událostí včetně historie před případným přesunem na
            tento LV. Úplnou historii najdete u jednotlivých objektů.
          </p>
          {group.events.length ? (
            <ol className="space-y-2">
              {group.events.map((event) => (
                <li key={event.id} className="text-sm">
                  <Link
                    className="underline"
                    to="/dashboard/watches/$id"
                    params={{ id: event.watchId }}
                    search={{ event: event.id }}
                    hash={`event-${event.id}`}
                  >
                    {event.label}: {event.summary}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatCheckTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm">Zatím bez zachycených událostí.</p>
          )}
        </section>
      ))}
    </DashboardShell>
  )
}
