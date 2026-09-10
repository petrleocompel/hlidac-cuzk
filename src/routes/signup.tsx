import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/auth/client'
import { ThemeToggle } from '#/components/theme-toggle'
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
import { SsoSignInButtons } from '#/components/auth/sso-sign-in-buttons'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
})

function SignupPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error: err } = await authClient.signUp.email({
      name: name || email.split('@')[0] || 'User',
      email,
      password,
    })
    setPending(false)
    if (err) {
      setError(err.message ?? 'Registrace selhala')
      return
    }
    void navigate({ to: '/dashboard' })
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="absolute right-6 top-6">
        <ThemeToggle compact />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Registrace</CardTitle>
          <CardDescription>Vytvořte účet pro sledování parcel</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="name">Jméno</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
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
              <Label htmlFor="password">Heslo (min. 12 znaků)</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? 'Vytvářím…' : 'Vytvořit účet'}
            </Button>
          </form>
          <div className="mt-4">
            <SsoSignInButtons />
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Už máte účet?{' '}
            <Link to="/login" className="text-primary underline-offset-4 hover:underline">
              Přihlášení
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
