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
import { Separator } from '#/components/ui/separator'
import {
  getNotificationSettings,
  saveNotificationSettings,
  testGotifyNotification,
  testSlackNotification,
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
  const [testingGotify, setTestingGotify] = useState(false)
  const [testingSlack, setTestingSlack] = useState(false)

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

  async function onTestGotify(form: HTMLFormElement) {
    const fd = new FormData(form)
    setTestingGotify(true)
    setError(null)
    setMessage(null)
    try {
      await testGotifyNotification({
        data: {
          gotifyUrl: String(fd.get('gotifyUrl') ?? '').trim(),
          gotifyToken: String(fd.get('gotifyToken') ?? '').trim(),
          gotifyPriority: Number(fd.get('gotifyPriority') ?? 5),
        },
      })
      setMessage('Gotify: test odeslán')
    } catch (err) {
      setError(
        err instanceof Error ? `Gotify: ${err.message}` : `Gotify: ${String(err)}`,
      )
    } finally {
      setTestingGotify(false)
    }
  }

  async function onTestSlack(form: HTMLFormElement) {
    const fd = new FormData(form)
    setTestingSlack(true)
    setError(null)
    setMessage(null)
    try {
      await testSlackNotification({
        data: {
          slackWebhookUrl: String(fd.get('slackWebhookUrl') ?? '').trim(),
        },
      })
      setMessage('Slack: test odeslán')
    } catch (err) {
      setError(
        err instanceof Error ? `Slack: ${err.message}` : `Slack: ${String(err)}`,
      )
    } finally {
      setTestingSlack(false)
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
            Gotify a Slack webhook (Slack-kompatibilní JSON). Test používá
            hodnoty z formuláře — nemusíte nejdřív ukládat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={onSubmit}>
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-medium">Gotify</h2>
                <p className="text-xs text-muted-foreground">
                  Server URL + application token
                </p>
              </div>
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
              <Button
                type="button"
                variant="outline"
                disabled={testingGotify || pending}
                onClick={(e) => {
                  const form = e.currentTarget.form
                  if (form) void onTestGotify(form)
                }}
              >
                {testingGotify ? 'Testuji Gotify…' : 'Test Gotify'}
              </Button>
            </section>

            <Separator />

            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-medium">Slack webhook</h2>
                <p className="text-xs text-muted-foreground">
                  Incoming webhook URL (i Discord v Slack režimu)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slackWebhookUrl">Webhook URL</Label>
                <Input
                  id="slackWebhookUrl"
                  name="slackWebhookUrl"
                  defaultValue={settings.slackWebhookUrl ?? ''}
                  placeholder="https://hooks.slack.com/…"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={testingSlack || pending}
                onClick={(e) => {
                  const form = e.currentTarget.form
                  if (form) void onTestSlack(form)
                }}
              >
                {testingSlack ? 'Testuji Slack…' : 'Test Slack'}
              </Button>
            </section>

            <Separator />

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
