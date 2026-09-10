import { Link, createFileRoute } from '@tanstack/react-router'
import { MapPinned } from 'lucide-react'
import { ThemeToggle } from '#/components/theme-toggle'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="absolute right-6 top-6">
        <ThemeToggle compact />
      </div>
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <MapPinned className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Peelco
        </p>
      </div>
      <h1 className="max-w-2xl text-5xl font-semibold tracking-tight md:text-6xl">
        Hlídač ČÚZK
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted-foreground">
        Sledujte parcely v katastru nemovitostí a dostávejte upozornění do
        Gotify, Discordu nebo Slacku, když se objeví nové řízení (plomba).
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link to="/login">Přihlásit se</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/signup">Vytvořit účet</Link>
        </Button>
      </div>
    </main>
  )
}
