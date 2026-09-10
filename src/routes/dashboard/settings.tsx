import { createFileRoute, redirect } from '@tanstack/react-router'
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
  getNotificationSettings,
  saveNotificationSettings,
} from '#/server/settings'

export const Route = createFileRoute('/dashboard/settings')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    const settings = await getNotificationSettings()
    return { session, settings }
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { session, settings } = Route.useLoaderData()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await saveNotificationSettings({
        data: {
          gotifyUrl: String(fd.get('gotifyUrl') ?? ''),
          gotifyToken: String(fd.get('gotifyToken') ?? ''),
          gotifyPriority: Number(fd.get('gotifyPriority') ?? 5),
          slackWebhookUrl: String(fd.get('slackWebhookUrl') ?? ''),
        },
      })
      setMessage('Uloženo')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <DashboardShell
      email={session.user.email}
      isAdmin={session.user.role === 'admin'}
    >
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Notifikace</CardTitle>
          <CardDescription>
            Gotify a Slack webhook (Slack-kompatibilní JSON)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="gotifyUrl">Gotify URL</Label>
              <Input
                id="gotifyUrl"
                name="gotifyUrl"
                defaultValue={settings.gotifyUrl ?? ''}
                placeholder="https://gotify.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gotifyToken">Gotify token</Label>
              <Input
                id="gotifyToken"
                name="gotifyToken"
                defaultValue={settings.gotifyToken ?? ''}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gotifyPriority">Gotify priorita</Label>
              <Input
                id="gotifyPriority"
                name="gotifyPriority"
                type="number"
                min={0}
                max={10}
                defaultValue={settings.gotifyPriority ?? 5}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slackWebhookUrl">Slack webhook URL</Label>
              <Input
                id="slackWebhookUrl"
                name="slackWebhookUrl"
                defaultValue={settings.slackWebhookUrl ?? ''}
                placeholder="https://hooks.slack.com/…"
              />
            </div>
            {message ? <p className="text-sm text-primary">{message}</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? 'Ukládám…' : 'Uložit'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
