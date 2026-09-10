import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/auth/client'
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

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error: err } = await authClient.signIn.email({
      email,
      password,
    })
    setPending(false)
    if (err) {
      setError(err.message ?? 'Přihlášení selhalo')
      return
    }
    void navigate({ to: '/dashboard' })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Přihlášení</CardTitle>
          <CardDescription>Hlídač ČÚZK — e-mail a heslo</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? 'Přihlašuji…' : 'Přihlásit'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Nemáte účet?{' '}
            <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
              Registrace
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
