import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  getNotificationPolicyAdmin,
  saveNotificationPolicyAdmin,
} from '#/server/admin/notifications'

export const Route = createFileRoute('/admin/notifications')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session, policy: await getNotificationPolicyAdmin() }
  },
  component: NotificationPolicyPage,
})
function NotificationPolicyPage() {
  const { session, policy } = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto w-full max-w-xl space-y-5">
        <h1 className="text-2xl font-semibold">Pravidla notifikací</h1>
        <p>
          Vypnutí kanálu zastaví nové požadavky všech uživatelů. Již odeslaný
          požadavek nelze odvolat.
        </p>
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setPending(true)
            setMessage('')
            setError('')
            try {
              await saveNotificationPolicyAdmin({
                data: {
                  gotifyEnabled: form.has('gotifyEnabled'),
                  slackEnabled: form.has('slackEnabled'),
                  discordEnabled: form.has('discordEnabled'),
                  ntfyEnabled: form.has('ntfyEnabled'),
                  emailEnabled: form.has('emailEnabled'),
                  ntfyAllowedUrls: String(form.get('ntfyAllowedUrls') ?? '')
                    .split('\n')
                    .map((v) => v.trim())
                    .filter(Boolean),
                  gotifyAllowedUrls: String(form.get('gotifyAllowedUrls') ?? '')
                    .split('\n')
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
              })
              setMessage('Pravidla uložena pro web i worker.')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Uložení selhalo.')
            } finally {
              setPending(false)
            }
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <legend className="mb-3 font-medium">Povolené kanály</legend>
            {(['gotify', 'slack', 'discord', 'ntfy', 'email'] as const).map(
              (channel) => (
                <label key={channel} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={`${channel}Enabled`}
                    defaultChecked={policy[`${channel}Enabled`]}
                  />
                  {channel === 'gotify'
                    ? 'Gotify'
                    : channel === 'slack'
                      ? 'Slack'
                      : channel === 'discord'
                        ? 'Discord'
                        : channel === 'ntfy'
                          ? 'ntfy'
                          : 'E-mail'}
                </label>
              ),
            )}
            <Label htmlFor="gotifyAllowedUrls">
              Whitelist Gotify: jedna základní URL na řádek
            </Label>
            <textarea
              id="gotifyAllowedUrls"
              name="gotifyAllowedUrls"
              rows={5}
              defaultValue={policy.gotifyAllowedUrls.join('\n')}
              aria-describedby="whitelistHelp"
              className="w-full rounded-md border bg-background p-2"
            />
            <p id="whitelistHelp" className="text-sm text-muted-foreground">
              Prázdný seznam povoluje všechny HTTP/HTTPS servery včetně LAN.
              Vyplněný povoluje pouze přesně uvedené adresy včetně případné
              cesty. Slack a Discord používají pouze své oficiální webhooky.
            </p>
            <Label htmlFor="ntfyAllowedUrls">
              Whitelist ntfy: základní adresy serverů
            </Label>
            <textarea
              id="ntfyAllowedUrls"
              name="ntfyAllowedUrls"
              rows={4}
              defaultValue={policy.ntfyAllowedUrls.join('\n')}
              className="w-full rounded-md border bg-background p-2"
            />
            <p className="text-sm text-muted-foreground">
              Vyplněný seznam povolí uvedené servery i jejich témata včetně
              interního HTTP. Prázdný seznam povolí HTTPS servery. SMTP zadává
              správce v konfiguraci instance.
            </p>
            <Button type="submit">
              {pending ? 'Ukládám…' : 'Uložit pravidla'}
            </Button>
          </fieldset>
        </form>
        <p role="status">{message}</p>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </DashboardShell>
  )
}
