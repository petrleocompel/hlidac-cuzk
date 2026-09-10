import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
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
import { createWatch } from '#/server/watches'

export const Route = createFileRoute('/dashboard/watches/new')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    return { session }
  },
  component: NewWatchPage,
})

function NewWatchPage() {
  const { session } = Route.useLoaderData()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    try {
      const subdivRaw = String(fd.get('parcelSubdivision') ?? '').trim()
      const watch = await createWatch({
        data: {
          label: String(fd.get('label') ?? ''),
          kuCode: String(fd.get('kuCode') ?? ''),
          kuName: String(fd.get('kuName') ?? ''),
          parcelNumber: Number(fd.get('parcelNumber')),
          parcelSubdivision: subdivRaw === '' ? null : Number(subdivRaw),
          druhCislovani: Number(fd.get('druhCislovani') ?? 2),
          pollIntervalMinutes: Number(fd.get('pollIntervalMinutes') ?? 60),
        },
      })
      void navigate({
        to: '/dashboard/watches/$id',
        params: { id: watch.id },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
          <CardTitle>Nová sledovaná parcela</CardTitle>
          <CardDescription>
            Při uložení se přes ČÚZK API ověří ISKN identifikátor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="label">Název</Label>
              <Input id="label" name="label" required placeholder="Vejprnice 1133/77" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kuName">Katastrální území</Label>
                <Input id="kuName" name="kuName" required placeholder="Vejprnice" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kuCode">Kód KÚ</Label>
                <Input id="kuCode" name="kuCode" required placeholder="744081" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="parcelNumber">Kmenové číslo</Label>
                <Input
                  id="parcelNumber"
                  name="parcelNumber"
                  type="number"
                  required
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parcelSubdivision">Poddělení</Label>
                <Input
                  id="parcelSubdivision"
                  name="parcelSubdivision"
                  type="number"
                  min={0}
                  placeholder="volitelné"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="druhCislovani">Druh číslování</Label>
                <select
                  id="druhCislovani"
                  name="druhCislovani"
                  defaultValue={2}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value={2}>2 — pozemková</option>
                  <option value={1}>1 — stavební</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pollIntervalMinutes">Interval (minuty)</Label>
              <Input
                id="pollIntervalMinutes"
                name="pollIntervalMinutes"
                type="number"
                defaultValue={60}
                min={5}
                max={1440}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? 'Ověřuji v ČÚZK…' : 'Uložit sledování'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </DashboardShell>
  )
}
