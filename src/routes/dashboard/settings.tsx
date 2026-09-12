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
  testNotificationSettings,
} from '#/server/settings'

export const Route = createFileRoute('/dashboard/settings')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session, settings: await getNotificationSettings() }
  },
  component: SettingsPage,
})

type SecretAction = 'keep' | 'replace' | 'remove'
const channels = [
  {
    channel: 'gotify',
    name: 'Gotify token',
    field: 'gotifyToken',
    flag: 'gotifyTokenConfigured',
  },
  {
    channel: 'slack',
    name: 'Slack webhook',
    field: 'slackWebhookUrl',
    flag: 'slackWebhookConfigured',
  },
  {
    channel: 'discord',
    name: 'Discord webhook',
    field: 'discordWebhookUrl',
    flag: 'discordWebhookConfigured',
  },
] as const

function SecretInput({
  field,
  name,
  configured,
}: {
  field: string
  name: string
  configured: boolean
}) {
  const [action, setAction] = useState<SecretAction>('keep')
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {configured ? 'Uloženo ••••••••' : 'Není nastaveno'}
      </p>
      <Label htmlFor={`${field}Action`}>{name}: akce</Label>
      <select
        id={`${field}Action`}
        name={`${field}Action`}
        value={action}
        onChange={(e) => setAction(e.target.value as SecretAction)}
        className="w-full rounded-md border bg-background p-2"
      >
        <option value="keep">Ponechat</option>
        <option value="replace">Nahradit</option>
        <option value="remove">Odebrat</option>
      </select>
      {action === 'replace' ? (
        <>
          <Label htmlFor={field}>Nová hodnota: {name}</Label>
          <Input
            id={field}
            name={field}
            type="password"
            autoComplete="new-password"
            required
            maxLength={4096}
          />
        </>
      ) : null}
    </div>
  )
}

function SettingsPage() {
  const loaded = Route.useLoaderData()
  const [settings, setSettings] = useState(loaded.settings)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const patch = (field: string) => {
      const action = fd.get(`${field}Action`) as SecretAction
      return action === 'replace'
        ? { action, value: String(fd.get(field) ?? '') }
        : { action }
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      setSettings(
        await saveNotificationSettings({
          data: {
            gotifyUrl: String(fd.get('gotifyUrl') ?? ''),
            gotifyPriority: Number(fd.get('gotifyPriority') ?? 5),
            gotifyToken: patch('gotifyToken'),
            slackWebhookUrl: patch('slackWebhookUrl'),
            discordWebhookUrl: patch('discordWebhookUrl'),
          },
        }),
      )
      setRevision((value) => value + 1)
      setMessage('Nastavení uloženo.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Uložení selhalo.')
    } finally {
      setPending(false)
    }
  }
  async function test(channel: 'gotify' | 'slack' | 'discord') {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await testNotificationSettings({ data: channel })
      setMessage('Testovací zpráva odeslána podle uloženého nastavení.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test selhal.')
    } finally {
      setPending(false)
    }
  }
  return (
    <DashboardShell
      user={loaded.session.user}
      isAdmin={loaded.session.user.role === 'admin'}
    >
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1>Notifikace</h1>
          </CardTitle>
          <CardDescription>
            Uložené tokeny se nezobrazují. Změny nejprve uložte; test používá
            uložené nastavení.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!settings.encryptionConfigured ? (
            <p role="alert" className="mb-4 text-sm text-destructive">
              Správce musí nakonfigurovat šifrovací klíč notifikací. Nové tokeny
              zatím nelze uložit.
            </p>
          ) : null}
          <form key={revision} onSubmit={onSubmit} className="space-y-6">
            <fieldset disabled={pending} className="space-y-6">
              <legend className="sr-only">Notifikační kanály</legend>
              {channels.map(({ channel, name, field, flag }) => (
                <section
                  key={channel}
                  className="space-y-4"
                  aria-labelledby={`${channel}Heading`}
                >
                  <h2 id={`${channel}Heading`} className="font-medium">
                    {name}
                  </h2>
                  {channel === 'gotify' ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="gotifyUrl">
                          Gotify URL povolená správcem
                        </Label>
                        <Input
                          id="gotifyUrl"
                          name="gotifyUrl"
                          type="url"
                          defaultValue={settings.gotifyUrl ?? ''}
                          placeholder="https://gotify.example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gotifyPriority">
                          Priorita Gotify (0–10)
                        </Label>
                        <Input
                          id="gotifyPriority"
                          name="gotifyPriority"
                          type="number"
                          min={0}
                          max={10}
                          defaultValue={settings.gotifyPriority}
                        />
                      </div>
                    </>
                  ) : null}
                  <SecretInput
                    field={field}
                    name={name}
                    configured={settings[flag]}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!settings[flag]}
                    onClick={() => void test(channel)}
                  >
                    Test{' '}
                    {channel === 'gotify'
                      ? 'Gotify'
                      : channel === 'slack'
                        ? 'Slack'
                        : 'Discord'}
                  </Button>
                </section>
              ))}
              <Button type="submit">
                {pending ? 'Zpracovávám…' : 'Uložit nastavení'}
              </Button>
            </fieldset>
          </form>
          <p role="status" className="mt-4 text-sm">
            {message}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
