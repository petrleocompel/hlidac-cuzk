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
  {
    channel: 'ntfy',
    name: 'ntfy token',
    field: 'ntfyToken',
    flag: 'ntfyTokenConfigured',
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

function clockText(value: number | null) {
  return value == null
    ? ''
    : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
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
            useInstanceGotify: fd.has('useInstanceGotify'),
            ntfyUrl: String(fd.get('ntfyUrl') ?? ''),
            ntfyToken: patch('ntfyToken'),
            emailTo: String(fd.get('emailTo') ?? ''),
            timezone: String(fd.get('timezone') ?? 'Europe/Prague'),
            quietFromMinutes: fd.get('quietFrom')
              ? String(fd.get('quietFrom'))
                  .split(':')
                  .reduce((h, m) => h * 60 + Number(m), 0)
              : null,
            quietToMinutes: fd.get('quietTo')
              ? String(fd.get('quietTo'))
                  .split(':')
                  .reduce((h, m) => h * 60 + Number(m), 0)
              : null,
            digestMode: String(fd.get('digestMode') ?? 'off') as
              'off' | 'daily' | 'weekly',
            digestHour: Number(fd.get('digestHour')),
            digestWeekday: Number(fd.get('digestWeekday')),
            urgentKinds: fd.getAll('urgentKinds').map(String) as Array<
              | 'new_rizeni'
              | 'rizeni_progress'
              | 'lv_change'
              | 'parcel_attrs'
              | 'error'
            >,
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
  async function test(
    channel: 'gotify' | 'slack' | 'discord' | 'ntfy' | 'email',
  ) {
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
              <section className="space-y-3">
                <h2 className="font-medium">Kdy doručovat</h2>
                <Label htmlFor="timezone">Časové pásmo</Label>
                <Input
                  id="timezone"
                  name="timezone"
                  defaultValue={settings.timezone}
                  required
                />
                <Label htmlFor="quietFrom">Klid od (prázdné vypne klid)</Label>
                <Input
                  id="quietFrom"
                  name="quietFrom"
                  type="time"
                  defaultValue={clockText(settings.quietFromMinutes)}
                />
                <Label htmlFor="quietTo">Klid do</Label>
                <Input
                  id="quietTo"
                  name="quietTo"
                  type="time"
                  defaultValue={clockText(settings.quietToMinutes)}
                />
                <Label htmlFor="digestMode">Souhrn</Label>
                <select
                  id="digestMode"
                  name="digestMode"
                  defaultValue={settings.digestMode}
                  className="w-full rounded-md border bg-background p-2"
                >
                  <option value="off">Každá změna zvlášť</option>
                  <option value="daily">Denně</option>
                  <option value="weekly">Týdně</option>
                </select>
                <Label htmlFor="digestHour">Hodina souhrnu (0–23)</Label>
                <Input
                  id="digestHour"
                  name="digestHour"
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.digestHour}
                  required
                />
                <Label htmlFor="digestWeekday">Den týdenního souhrnu</Label>
                <select
                  id="digestWeekday"
                  name="digestWeekday"
                  defaultValue={settings.digestWeekday}
                  className="w-full rounded-md border bg-background p-2"
                >
                  {[
                    'Pondělí',
                    'Úterý',
                    'Středa',
                    'Čtvrtek',
                    'Pátek',
                    'Sobota',
                    'Neděle',
                  ].map((day, i) => (
                    <option key={day} value={i + 1}>
                      {day}
                    </option>
                  ))}
                </select>
                <fieldset className="space-y-2">
                  <legend>Důležité změny: ihned, i během klidu</legend>
                  {[
                    ['new_rizeni', 'Plomby'],
                    ['rizeni_progress', 'Průběh řízení'],
                    ['lv_change', 'LV'],
                    ['parcel_attrs', 'Atributy'],
                  ].map(([kind, label]) => (
                    <label className="flex items-center gap-2" key={kind}>
                      <input
                        type="checkbox"
                        name="urgentKinds"
                        value={kind}
                        defaultChecked={settings.urgentKinds.includes(kind)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <p className="text-sm text-muted-foreground">
                  Filtr událostí a kanálů nastavíte v detailu každého sledování.
                  Historie zůstává úplná. Souhrn během klidu počká.
                </p>
              </section>
              <section className="space-y-3">
                <h2 className="font-medium">E-mail</h2>
                <p>
                  {settings.emailAvailable
                    ? 'SMTP instance je nastavené.'
                    : 'Správce zatím nenastavil SMTP.'}
                </p>
                <Label htmlFor="emailTo">Adresa příjemce</Label>
                <Input
                  id="emailTo"
                  name="emailTo"
                  type="email"
                  defaultValue={settings.emailTo ?? ''}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => test('email')}
                  disabled={!settings.emailTo}
                >
                  Test e-mailu
                </Button>
              </section>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="useInstanceGotify"
                  defaultChecked={settings.useInstanceGotify}
                  disabled={!settings.gotifyInstanceDefault}
                />
                Použít společné Gotify správce, pokud nemám vlastní nastavení
              </label>
              <p className="text-sm text-muted-foreground">
                Společný kanál může číst správce i jeho další odběratelé.
                Vlastní úplné nastavení má přednost; částečné nastavení se se
                serverovým tokenem nekombinuje.
              </p>
              {channels.map(({ channel, name, field, flag }) => (
                <section
                  key={channel}
                  className="space-y-4"
                  aria-labelledby={`${channel}Heading`}
                >
                  <h2 id={`${channel}Heading`} className="font-medium">
                    {name}
                  </h2>
                  {channel === 'ntfy' ? (
                    <>
                      <Label htmlFor="ntfyUrl">ntfy URL tématu</Label>
                      <Input
                        id="ntfyUrl"
                        name="ntfyUrl"
                        type="url"
                        defaultValue={settings.ntfyUrl ?? ''}
                        placeholder="https://ntfy.example.cz/moje-tema"
                      />
                      <p className="text-sm text-muted-foreground">
                        Token je volitelný. Interní HTTP server musí správce
                        uvést ve whitelistu.
                      </p>
                    </>
                  ) : null}
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
                    disabled={
                      channel === 'ntfy'
                        ? !settings.ntfyUrl
                        : channel === 'gotify'
                          ? !(
                              settings.gotifyTokenConfigured ||
                              settings.useInstanceGotify
                            )
                          : !settings[flag]
                    }
                    onClick={() => void test(channel)}
                  >
                    Test{' '}
                    {channel === 'gotify'
                      ? 'Gotify'
                      : channel === 'slack'
                        ? 'Slack'
                        : channel === 'discord'
                          ? 'Discord'
                          : 'ntfy'}
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
