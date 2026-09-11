import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader } from '#/components/ui/card'
import {
  getCuzkMetricsAdmin,
  refreshCuzkAccountAdmin,
} from '#/server/admin/cuzk'

export const Route = createFileRoute('/admin/cuzk')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session, metrics: await getCuzkMetricsAdmin() }
  },
  component: CuzkPage,
})

function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Prague',
      }).format(new Date(value))
    : 'Dosud nezjištěno'
}

function CuzkPage() {
  const { session, metrics: m } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function refresh(account = false) {
    setPending(true)
    setMessage('')
    try {
      if (account) {
        const result = await refreshCuzkAccountAdmin()
        setMessage(
          result.refreshed
            ? 'Stav účtu byl aktualizován.'
            : 'Stav účtu lze ověřit nejvýše jednou za 15 minut.',
        )
      }
      await router.invalidate()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Aktualizace selhala.',
      )
      await router.invalidate()
    } finally {
      setPending(false)
    }
  }
  const completed = m.today.success + m.today.errors
  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">ČÚZK · spotřeba API</h1>
            <p className="text-sm text-muted-foreground">
              Den {m.day}, časové pásmo Europe/Prague. Obnovení rozpočtu:{' '}
              {date(m.resetsAt)}.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void refresh()}
          >
            Obnovit přehled
          </Button>
        </div>
        <p role="status" className="text-sm">
          {message}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Dnešní spotřeba</h2>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-3xl font-semibold">
                {m.today.reserved} / {m.limit}
              </p>
              <progress
                className="w-full accent-primary"
                value={m.today.reserved}
                max={m.limit}
                aria-label="Spotřeba denního rozpočtu"
              />
              <p>Zbývá {m.remaining} volání.</p>
              {m.today.reserved >= 400 && (
                <p className="font-medium">
                  {m.remaining === 0
                    ? 'Rozpočet je vyčerpaný. Další volání jsou zastavena.'
                    : 'Spotřeba dosáhla alespoň 80 % rozpočtu.'}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Chyby a odezva</h2>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>
                {m.today.errors} chyb (
                {completed ? Math.round((100 * m.today.errors) / completed) : 0}{' '}
                % dokončených)
              </p>
              <p>Průměr {m.today.averageMs} ms</p>
              <p>
                {m.today.retries} opakovaných pokusů · {m.today.pending} bez
                výsledku
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="text-xl font-semibold">Plánovaná zátěž</h2>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>{m.demand.watches} aktivních sledování</p>
              <p>Nejméně {m.demand.minimumDailyCalls} volání / den</p>
              <p className="text-sm text-muted-foreground">
                Bez detailů řízení, vyhledávání, ručních kontrol a opakování.
              </p>
              {m.demand.minimumDailyCalls >= 500 && (
                <p className="font-medium">
                  Prodlužte intervaly nebo pozastavte část sledování; plán
                  vyčerpá rozpočet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <p className="text-sm text-muted-foreground">
          Počítají se všechny rezervované pokusy této instalace, včetně chyb a
          ověření účtu. Nedokončené pokusy po pádu procesu zůstávají započtené.
          Přehled čte jen databázi a nespotřebovává volání ČÚZK.
        </p>
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Poslední stav účtu ČÚZK</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>Ověřeno: {date(m.accountCheckedAt)}</p>
            {m.account ? (
              <>
                <p>
                  Období hlášené ČÚZK: {m.account.aktualniObdobi} ·{' '}
                  {m.account.provedenoVolani} / {m.account.limitVolani} volání
                </p>
                <p>Platnost klíče do {date(m.account.expiraceApiKey)}</p>
                {Date.parse(m.account.expiraceApiKey) - Date.now() <
                  7 * 86400000 && (
                  <p className="font-medium">
                    Klíč vypršel nebo vyprší do 7 dnů. Připravte nový klíč.
                  </p>
                )}
              </>
            ) : (
              <p>Stav účtu zatím není dostupný.</p>
            )}
            <p className="text-sm text-muted-foreground">
              Údaj ČÚZK může zahrnovat volání jiných aplikací. Jde o uložený
              stav, nikoli živé počítadlo. Worker jej ověřuje každých 6 hodin.
            </p>
            {m.accountError && (
              <p>Poslední ověření selhalo: {m.accountError}</p>
            )}
            {m.blockedUntil && Date.parse(m.blockedUntil) > Date.now() && (
              <p>
                Volání pozastavena do {date(m.blockedUntil)}. {m.blockedReason}
              </p>
            )}
            <Button disabled={pending} onClick={() => void refresh(true)}>
              Ověřit účet u ČÚZK
            </Button>
            <p className="text-sm text-muted-foreground">
              Spotřebuje volání API, nejvýše jednou za 15 minut. Platí denní
              limit i pravidla opakování.
            </p>
          </CardContent>
        </Card>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="p-3 text-left font-semibold">
              Dnešní volání podle endpointu
            </caption>
            <thead>
              <tr>
                {['Endpoint', 'Pokusy', 'Chyby', 'Průměr (ms)'].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.endpoints.length ? (
                m.endpoints.map((row) => (
                  <tr key={row.endpoint} className="border-t">
                    <th scope="row" className="p-3 break-all font-normal">
                      {row.endpoint}
                    </th>
                    <td className="p-3">{row.requests}</td>
                    <td className="p-3">{row.errors}</td>
                    <td className="p-3">{row.averageMs}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-3">
                    Dnes nejsou evidována žádná volání.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <caption className="p-3 text-left font-semibold">
              Historie za 30 dní
            </caption>
            <thead>
              <tr>
                {[
                  'Den',
                  'Spotřeba',
                  'Úspěchy',
                  'Chyby',
                  'Bez výsledku',
                  'Opakování',
                  'Průměr (ms)',
                ].map((label) => (
                  <th key={label} scope="col" className="p-3">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.history.map((row) => (
                <tr key={row.day} className="border-t">
                  <th scope="row" className="p-3 font-normal">
                    {row.day}
                  </th>
                  {[
                    row.reserved,
                    row.success,
                    row.errors,
                    row.pending,
                    row.retries,
                    row.averageMs,
                  ].map((value, i) => (
                    <td key={i} className="p-3">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  )
}
