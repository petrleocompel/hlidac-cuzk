import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import { formatCheckTime } from '#/lib/monitoring/freshness'
import { getMonitoringAdmin } from '#/server/admin/monitoring'

export const Route = createFileRoute('/admin/monitoring')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session, health: await getMonitoringAdmin() }
  },
  component: MonitoringPage,
})
function MonitoringPage() {
  const { session, health: h } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Stav kontrol a workeru</h1>
          <Button
            variant="outline"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              setMessage('')
              try {
                await router.invalidate()
                setMessage('Stav byl obnoven.')
              } catch {
                setMessage(
                  'Stav nelze načíst. Ověřte dostupnost databáze a /readyz.',
                )
              } finally {
                setPending(false)
              }
            }}
          >
            Obnovit stav
          </Button>
        </div>
        <p role="status">{message}</p>
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">
            {h.healthy ? 'Kontroly fungují' : 'Kontroly vyžadují pozornost'}
          </h2>
          <p>
            {h.heartbeatHealthy
              ? 'Scheduler se pravidelně hlásí.'
              : 'Worker se nehlásí déle než 2 minuty nebo ještě nebyl spuštěn.'}
          </p>
          <p>
            {h.progressHealthy
              ? 'Úlohy kontrol a doručování dokončily běh v posledních 10 minutách.'
              : 'Chybí nedávný dokončený běh kontrol nebo doručování. Úloha může být zaseknutá nebo scheduler nově spuštěný.'}
          </p>
          <p>
            {h.watches.overdue} zpožděných kontrol · {h.watches.stale} sledování
            se zastaralými daty · {h.watches.neverSuccessful} bez úspěšného
            načtení
          </p>
          <p className="text-sm text-muted-foreground">
            Zpoždění se vyhodnocuje s tolerancí 10 minut. Pozastavená sledování
            se nepočítají. Načteno {formatCheckTime(h.checkedAt)}.
          </p>
        </section>
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Dostupnost workeru</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt>Poslední heartbeat</dt>
              <dd>{formatCheckTime(h.heartbeatAt)}</dd>
            </div>
            <div>
              <dt>Poslední spuštění scheduleru</dt>
              <dd>{formatCheckTime(h.startedAt)}</dd>
            </div>
            <div>
              <dt>Poslední zaznamenaný výpadek</dt>
              <dd>{formatCheckTime(h.lastOutageAt)}</dd>
            </div>
            <div>
              <dt>Obnovení po výpadku</dt>
              <dd>{formatCheckTime(h.recoveredAt)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            Obnovení heartbeat potvrzuje běh scheduleru; úspěšné načtení dat
            ověřujte také v souhrnu úloh a u parcel.
          </p>
        </section>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <caption className="p-3 text-left font-semibold">
              Poslední běhy úloh
            </caption>
            <thead>
              <tr>
                {[
                  'Úloha',
                  'Zahájení',
                  'Dokončení',
                  'Poslední běh bez chyb',
                  'Výsledek',
                ].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.jobs.length ? (
                h.jobs.map((job) => (
                  <tr key={job.name} className="border-t">
                    <th scope="row" className="p-3 font-normal">
                      {job.name}
                    </th>
                    <td className="p-3">{formatCheckTime(job.startedAt)}</td>
                    <td className="p-3">{formatCheckTime(job.finishedAt)}</td>
                    <td className="p-3">
                      {formatCheckTime(job.lastSuccessfulAt)}
                    </td>
                    <td className="p-3">
                      {job.lastError ?? 'Bez zaznamenané chyby'}
                      {job.summary && (
                        <p className="mt-1 font-mono text-xs">
                          {Object.entries(job.summary)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(', ')}
                        </p>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-3">
                    Zatím nebyl zaznamenán žádný běh.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          Pro upozornění i při úplném vypnutí aplikace použijte externí monitor.
          /readyz ověřuje databázi a schéma; /api/monitoring a /api/metrics
          vyžadují monitorovací token. Návod obsahuje pravidla pro dlouhý
          výpadek a oznámení obnovení.
        </p>
      </div>
    </DashboardShell>
  )
}
