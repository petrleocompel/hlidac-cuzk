import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { getServerSession } from '#/auth/session'
import { ThemeToggle } from '#/components/theme-toggle'
import { Button } from '#/components/ui/button'
import { LandingHeroVisual } from '#/components/marketing/landing-hero-visual'

export const Route = createFileRoute('/')({
  loader: async () => {
    const session = await getServerSession()
    if (session) throw redirect({ to: '/dashboard' })
  },
  component: LandingPage,
})

function LandingPage() {
  return (
    <div className="landing-page min-h-screen overflow-x-hidden">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 md:px-10 md:py-5">
        <p className="min-w-0 truncate text-xs font-medium uppercase tracking-[0.22em] text-[#F7F5F0]/70">
          Peelco
        </p>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <ThemeToggle
            compact
            className="border-[#F7F5F0]/20 bg-[#F7F5F0]/10 [&_button]:text-[#F7F5F0]/75 [&_button[aria-pressed=true]]:bg-[#F7F5F0]/20 [&_button[aria-pressed=true]]:text-[#F7F5F0]"
          />
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="hidden bg-[#F7F5F0]/10 text-[#F7F5F0] hover:bg-[#F7F5F0]/20 sm:inline-flex"
          >
            <Link to="/login">Přihlásit se</Link>
          </Button>
        </div>
      </header>

      <section className="landing-hero relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-[#1A3F52] text-[#F7F5F0] md:justify-center">
        <LandingHeroVisual />
        <div className="landing-hero-copy relative z-10 mx-auto flex w-full max-w-6xl flex-col px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-28 sm:px-6 sm:pb-16 md:px-10 md:pb-24 md:pt-20">
          <h1 className="landing-fade-up max-w-[14ch] text-balance text-[2.5rem] font-semibold leading-[1.08] tracking-tight sm:max-w-3xl sm:text-5xl md:text-7xl">
            Hlídač ČÚZK
          </h1>
          <p className="landing-fade-up landing-fade-up-delay-1 mt-4 max-w-xl text-base leading-relaxed text-[#D7E6EC] sm:mt-6 sm:text-lg md:text-xl">
            Sledujte parcely v katastru nemovitostí a dostávejte upozornění, když
            se objeví nové řízení nebo se změní list vlastnictví.
          </p>
          <div className="landing-fade-up landing-fade-up-delay-2 mt-8 flex w-full flex-col gap-3 sm:mt-10 sm:w-auto sm:flex-row sm:flex-wrap">
            <Button
              asChild
              size="lg"
              className="h-12 w-full bg-[#F7F5F0] text-[#1A3F52] hover:bg-white sm:w-auto"
            >
              <Link to="/login">Přihlásit se</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full border-[#8EC4D4]/50 bg-transparent text-[#F7F5F0] hover:bg-[#F7F5F0]/10 hover:text-[#F7F5F0] sm:w-auto"
            >
              <Link to="/signup">Vytvořit účet</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 md:px-10 md:py-28">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Co sledujeme
        </p>
        <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
          Změny, které u parcely opravdu počítají
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
          Hlídač pravidelně kontroluje veřejná data ČÚZK a upozorní vás dřív, než
          změnu sami objevíte v nahlížení do katastru.
        </p>
        <ul className="mt-10 grid gap-8 sm:mt-12 sm:gap-10 md:grid-cols-3 md:gap-12">
          <li className="border-t border-border pt-5 sm:pt-6">
            <p className="text-sm font-medium text-primary">01</p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight sm:text-xl">
              Nová řízení a plomby
            </h3>
            <p className="mt-3 text-muted-foreground">
              Jakmile se u parcely objeví nové řízení, dostanete zprávu — včetně
              signálu o vkladu.
            </p>
          </li>
          <li className="border-t border-border pt-5 sm:pt-6">
            <p className="text-sm font-medium text-primary">02</p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight sm:text-xl">
              Změna listu vlastnictví
            </h3>
            <p className="mt-3 text-muted-foreground">
              Sledujeme číslo LV jako praktický indikátor změny vlastnických
              vztahů (jména vlastníků API neposkytuje).
            </p>
          </li>
          <li className="border-t border-border pt-5 sm:pt-6">
            <p className="text-sm font-medium text-primary">03</p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight sm:text-xl">
              Stav parcely
            </h3>
            <p className="mt-3 text-muted-foreground">
              Výměra, druh pozemku a další atributy — přehledně na jednom místě
              po každé kontrole.
            </p>
          </li>
        </ul>
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 md:px-10 md:py-28">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Jak to funguje
          </p>
          <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
            Tři kroky od parcely k upozornění
          </h2>
          <ol className="mt-10 space-y-0 sm:mt-12">
            <li className="grid gap-3 border-t border-border py-7 sm:gap-4 sm:py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-3xl font-semibold tracking-tight text-primary/80 sm:text-4xl">
                1
              </p>
              <div>
                <h3 className="text-lg font-semibold tracking-tight sm:text-xl">
                  Přidejte parcelu
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Zadáte katastrální území a parcelní číslo. Hlídač ověří parcelu
                  v ČÚZK a uloží výchozí snímek.
                </p>
              </div>
            </li>
            <li className="grid gap-3 border-t border-border py-7 sm:gap-4 sm:py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-3xl font-semibold tracking-tight text-primary/80 sm:text-4xl">
                2
              </p>
              <div>
                <h3 className="text-lg font-semibold tracking-tight sm:text-xl">
                  Automatická kontrola
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  V nastaveném intervalu se data znovu načtou a porovnají s
                  posledním známým stavem.
                </p>
              </div>
            </li>
            <li className="grid gap-3 border-t border-border py-7 sm:gap-4 sm:py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-3xl font-semibold tracking-tight text-primary/80 sm:text-4xl">
                3
              </p>
              <div>
                <h3 className="text-lg font-semibold tracking-tight sm:text-xl">
                  Notifikace k vám
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Při změně pošleme zprávu do Gotify, Discordu nebo Slacku —
                  podle toho, co máte zapnuté.
                </p>
              </div>
            </li>
          </ol>
          <div className="mt-6 flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:flex-wrap sm:pt-10">
            <Button asChild size="lg" className="h-12 w-full sm:w-auto">
              <Link to="/signup">Vytvořit účet</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 w-full sm:w-auto"
            >
              <Link to="/login">Už mám účet</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between md:px-10">
        <p>
          <span className="font-medium text-foreground">Hlídač ČÚZK</span>
          {' · '}
          Peelco
        </p>
        <p>Sledování parcel a notifikace změn z katastru nemovitostí.</p>
      </footer>
    </div>
  )
}
