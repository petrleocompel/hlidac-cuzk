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
    <div className="landing-page min-h-screen">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 md:px-10">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary-foreground/70">
          Peelco
        </p>
        <div className="flex items-center gap-3">
          <ThemeToggle compact />
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
          >
            <Link to="/login">Přihlásit se</Link>
          </Button>
        </div>
      </header>

      <section className="landing-hero relative flex min-h-[100svh] flex-col justify-end overflow-hidden bg-[#1A3F52] text-[#F7F5F0] md:justify-center">
        <LandingHeroVisual />
        <div className="landing-hero-copy relative z-10 mx-auto w-full max-w-6xl px-6 pb-16 pt-28 md:px-10 md:pb-24 md:pt-20">
          <h1 className="landing-fade-up max-w-3xl text-5xl font-semibold tracking-tight md:text-7xl">
            Hlídač ČÚZK
          </h1>
          <p className="landing-fade-up landing-fade-up-delay-1 mt-6 max-w-xl text-lg leading-relaxed text-[#D7E6EC] md:text-xl">
            Sledujte parcely v katastru nemovitostí a dostávejte upozornění, když
            se objeví nové řízení nebo se změní list vlastnictví.
          </p>
          <div className="landing-fade-up landing-fade-up-delay-2 mt-10 flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="bg-[#F7F5F0] text-[#1A3F52] hover:bg-white"
            >
              <Link to="/login">Přihlásit se</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-[#8EC4D4]/50 bg-transparent text-[#F7F5F0] hover:bg-[#F7F5F0]/10 hover:text-[#F7F5F0]"
            >
              <Link to="/signup">Vytvořit účet</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20 md:px-10 md:py-28">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Co sledujeme
        </p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
          Změny, které u parcely opravdu počítají
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
          Hlídač pravidelně kontroluje veřejná data ČÚZK a upozorní vás dřív, než
          změnu sami objevíte v nahlížení do katastru.
        </p>
        <ul className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
          <li className="border-t border-border pt-6">
            <p className="text-sm font-medium text-primary">01</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight">
              Nová řízení a plomby
            </h3>
            <p className="mt-3 text-muted-foreground">
              Jakmile se u parcely objeví nové řízení, dostanete zprávu — včetně
              signálu o vkladu.
            </p>
          </li>
          <li className="border-t border-border pt-6">
            <p className="text-sm font-medium text-primary">02</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight">
              Změna listu vlastnictví
            </h3>
            <p className="mt-3 text-muted-foreground">
              Sledujeme číslo LV jako praktický indikátor změny vlastnických
              vztahů (jména vlastníků API neposkytuje).
            </p>
          </li>
          <li className="border-t border-border pt-6">
            <p className="text-sm font-medium text-primary">03</p>
            <h3 className="mt-3 text-xl font-semibold tracking-tight">
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
        <div className="mx-auto max-w-6xl px-6 py-20 md:px-10 md:py-28">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Jak to funguje
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
            Tři kroky od parcely k upozornění
          </h2>
          <ol className="mt-12 space-y-0">
            <li className="grid gap-4 border-t border-border py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-4xl font-semibold tracking-tight text-primary/80">
                1
              </p>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Přidejte parcelu
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Zadáte katastrální území a parcelní číslo. Hlídač ověří parcelu
                  v ČÚZK a uloží výchozí snímek.
                </p>
              </div>
            </li>
            <li className="grid gap-4 border-t border-border py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-4xl font-semibold tracking-tight text-primary/80">
                2
              </p>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Automatická kontrola
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  V nastaveném intervalu se data znovu načtou a porovnají s
                  posledním známým stavem.
                </p>
              </div>
            </li>
            <li className="grid gap-4 border-t border-border py-8 md:grid-cols-[8rem_1fr] md:gap-10">
              <p className="text-4xl font-semibold tracking-tight text-primary/80">
                3
              </p>
              <div>
                <h3 className="text-xl font-semibold tracking-tight">
                  Notifikace k vám
                </h3>
                <p className="mt-2 max-w-2xl text-muted-foreground">
                  Při změně pošleme zprávu do Gotify, Discordu nebo Slacku —
                  podle toho, co máte zapnuté.
                </p>
              </div>
            </li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-10">
            <Button asChild size="lg">
              <Link to="/signup">Vytvořit účet</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/login">Už mám účet</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-10">
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
