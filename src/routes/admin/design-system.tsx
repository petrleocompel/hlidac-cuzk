import { createFileRoute, redirect } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import { ThemeToggle } from '#/components/theme-toggle'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from '#/components/ui/sidebar'
import { Skeleton } from '#/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/components/ui/tooltip'

export const Route = createFileRoute('/admin/design-system')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session }
  },
  component: DesignSystemPage,
})

const surfaceTokens = [
  { name: 'background', desc: 'stránka', className: 'bg-background' },
  { name: 'sidebar', desc: 'navigace', className: 'bg-sidebar' },
  { name: 'card', desc: 'panely, karty', className: 'bg-card' },
  { name: 'muted', desc: 'tiché výplně', className: 'bg-muted' },
  { name: 'accent', desc: 'hover, aktivní řádek', className: 'bg-accent' },
] as const

const semanticTokens = [
  { name: 'primary', desc: 'nová změna, akce', className: 'bg-primary' },
  {
    name: 'warning',
    desc: 'plomba, řízení',
    className: 'bg-warning border-b-2 border-warning-border',
  },
  { name: 'destructive', desc: 'selhaná kontrola', className: 'bg-destructive' },
  { name: 'secondary', desc: 'sekundární akce', className: 'bg-secondary' },
  { name: 'foreground', desc: 'text', className: 'bg-foreground' },
] as const

function TokenSwatch({
  name,
  desc,
  className,
}: {
  name: string
  desc: string
  className: string
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className={`h-16 ${className}`} />
      <div className="flex flex-col gap-0.5 border-t border-border bg-card px-3 py-2.5">
        <span className="font-mono text-xs">{name}</span>
        <span className="font-mono text-xs text-muted-foreground">{desc}</span>
      </div>
    </div>
  )
}

const statusBadges = [
  {
    label: 'Bez změny',
    variant: 'outline' as const,
    desc: 'Kontrola proběhla, data stejná. Nejtišší stav, je jich většina.',
    props: 'variant="outline"',
  },
  {
    label: 'Nová změna',
    variant: 'default' as const,
    desc: 'Změna v LV, kterou uživatel ještě neviděl. Jediná barva, kterou má na obrazovce hledat.',
    props: 'variant="default"',
  },
  {
    label: 'Probíhá řízení',
    variant: 'outline' as const,
    className: 'border-warning-border bg-warning text-warning-foreground',
    desc: 'Plomba nebo otevřené řízení. Něco se děje a není to dokončené — pozor, ne chyba.',
    props: 'outline + bg-warning',
  },
  {
    label: 'Kontrola selhala',
    variant: 'destructive' as const,
    desc: 'ČÚZK nedostupné, vyčerpaný limit, neplatné ID. Vždy s návodem, co dál.',
    props: 'variant="destructive"',
  },
  {
    label: 'Pozastaveno',
    variant: 'secondary' as const,
    desc: 'Uživatel hlídání vypnul. Řádek se odliší strukturou a tichostí, ne barvou.',
    props: 'variant="secondary"',
  },
]

const missingComponents = [
  { name: 'Tabs', where: 'Watch detail — sedm tabů podle sekce 2.2. Bez nich se osm panelů nedá rozdělit.' },
  { name: 'Table', where: 'Watches seznam, řízení, sousedi, admin users a audit log.' },
  {
    name: 'Alert',
    where: 'Banner o plombách nad taby, impersonation banner, výpadek ČÚZK. Varianta warning i destructive.',
  },
  { name: 'Progress', where: 'Denní limit 500 dotazů na dashboardu a v admin monitoringu.' },
  {
    name: 'Accordion',
    where: 'Části listu vlastnictví A–D, FAQ na landingu. Zatím zastoupeno Collapsible.',
  },
  { name: 'Switch', where: 'Notifikační pravidla, nastavení účtu a admin access.' },
  {
    name: 'ToggleGroup',
    where: 'Filtr typu události, přepínač tabulka/karty, theme toggle. V ukázce výše zastoupeno tlačítky.',
  },
  { name: 'Checkbox', where: 'Výběr řádků v seznamu pro hromadné akce.' },
  { name: 'Select, Popover, Command', where: 'Filtry v toolbaru, výběr intervalu, hledání katastrálního území.' },
  { name: 'AlertDialog, Sonner', where: 'Potvrzení smazání hlídání a potvrzení provedených akcí.' },
  { name: 'Chart, Empty, Pagination', where: 'Grafy v monitoringu, prázdné stavy seznamů, stránkování tabulek.' },
]

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {eyebrow}
      </span>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function DesignSystemPage() {
  const { session } = Route.useLoaderData()

  return (
    <DashboardShell user={session.user} isAdmin>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-14">
        <div className="flex items-start justify-between gap-7 border-b border-border pb-7">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-wide text-primary">
              Hlídač ČÚZK Design System
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">
              Komponenty použité v redesignu
            </h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              Každá sekce ukazuje skutečnou komponentu z design systému tak, jak je
              použitá v mockupech dashboardu a watch detailu. Na konci je seznam
              komponent, které v design systému zatím nejsou a je potřeba je
              doinstalovat.
            </p>
          </div>
          <ThemeToggle className="shrink-0" />
        </div>

        {/* 01 — Tokeny */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="01 — Tokeny"
            title="Vrstvy povrchů"
            description="Čtyři odlišené úrovně světlosti. V tmavém režimu se karta od pozadí liší světlostí, ne jen okrajem — to je oprava bodu 11 auditu, kterou design systém už řeší."
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {surfaceTokens.map((t) => (
              <TokenSwatch key={t.name} {...t} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {semanticTokens.map((t) => (
              <TokenSwatch key={t.name} {...t} />
            ))}
          </div>
        </section>

        {/* 02 — Badge */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="02 — Badge"
            title="Stavy objektu"
            description="Jedna barva, jeden význam. Plomba je warning, ne destructive — červená zůstává jen pro selhané kontroly. Každý badge nese text, aby barva nebyla jediným nosičem informace."
          />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="grid grid-cols-[minmax(140px,200px)_minmax(0,1fr)_minmax(140px,220px)] divide-x divide-border border-b border-border text-xs font-semibold text-muted-foreground">
              <div className="px-4 py-3">Badge</div>
              <div className="px-4 py-3">Kdy</div>
              <div className="px-4 py-3">Props</div>
            </div>
            {statusBadges.map((b) => (
              <div
                key={b.label}
                className="grid grid-cols-[minmax(140px,200px)_minmax(0,1fr)_minmax(140px,220px)] divide-x divide-border border-b border-border text-sm last:border-b-0"
              >
                <div className="flex items-center px-4 py-3">
                  <Badge variant={b.variant} className={'className' in b ? b.className : undefined}>
                    {b.label}
                  </Badge>
                </div>
                <div className="flex items-center px-4 py-3 text-[13.5px]">{b.desc}</div>
                <div className="flex items-center px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">{b.props}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[13.5px] text-muted-foreground">
            Tyto pětice patří do jedné komponenty{' '}
            <span className="font-mono text-xs">{'<WatchStatusBadge status="…" />'}</span>, aby se
            stav nikde nesestavoval ručně. Je to první úkol fáze 0 plánu.
          </p>
        </section>

        {/* 03 — Button */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="03 — Button"
            title="Akce a jejich váha"
            description="Na obrazovku jeden primární button. Na watch detailu je to Zkontrolovat nyní; Pozastavit a Upravit jsou outline, Smazat je v dropdown menu."
          />
          <div className="flex flex-col gap-5 rounded-md border border-border bg-card p-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button>Zkontrolovat nyní</Button>
              <Button variant="outline">Pozastavit</Button>
              <Button variant="outline">Upravit</Button>
              <Button variant="secondary">Zrušit výběr</Button>
              <Button variant="ghost">Zobrazit vše</Button>
              <Button variant="destructive">Smazat hlídání</Button>
              <Button variant="link">Zapomenuté heslo</Button>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm">sm — toolbar</Button>
              <Button>default</Button>
              <Button size="lg">lg — CTA landingu</Button>
              <Button size="icon" variant="outline" aria-label="Další akce">
                ···
              </Button>
            </div>
          </div>
        </section>

        {/* 04 — Card */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="04 — Card"
            title="Stat karta a panel"
            description="Stat karta ze stavového pásu dashboardu a panel s hlavičkou, který nesou všechny datové sekce watch detailu."
          />
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Sledované objekty</CardDescription>
                <CardTitle className="text-3xl tracking-tight tabular-nums">12</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0.5 text-sm">
                <span>z toho 1 pozastavené</span>
                <span className="text-xs text-muted-foreground">ve 4 katastrálních územích</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Plomby a řízení</CardDescription>
                <CardTitle className="text-3xl tracking-tight tabular-nums">2</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-1.5">
                <Badge variant="outline" className="border-warning-border bg-warning text-warning-foreground">
                  na 1 objektu
                </Badge>
                <span className="text-xs text-muted-foreground">nejstarší podáno 2. 9.</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Změny za 7 dní</CardDescription>
                <CardTitle className="text-3xl tracking-tight tabular-nums">3</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-1.5">
                <Badge>2 nepřečtené</Badge>
                <span className="text-xs text-muted-foreground">předchozí týden 0</span>
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-3.5 border-b border-border px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[15px] font-semibold">Co se změnilo</span>
                <span className="text-xs text-muted-foreground">Události napříč všemi objekty</span>
              </div>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="secondary">
                  Vše
                </Button>
                <Button size="sm" variant="ghost">
                  Plomby
                </Button>
                <Button size="sm" variant="ghost">
                  Změny LV
                </Button>
                <Button size="sm" variant="ghost">
                  Chyby
                </Button>
              </div>
            </div>
            <div className="flex items-start gap-3 border-b border-border bg-accent px-5 py-3.5">
              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Nová plomba u řízení V-4821/2026</span>
                  <Badge variant="outline" className="border-warning-border bg-warning text-warning-foreground">
                    plomba
                  </Badge>
                </div>
                <span className="text-[13px] text-muted-foreground">
                  Vejprnice 1133/77 · LV 2978 · vklad práva
                </span>
              </div>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">dnes 17:40</span>
            </div>
            <div className="flex items-start gap-3 border-b border-border px-5 py-3.5">
              <div className="mt-1.5 size-1.5 shrink-0 rounded-full border border-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Řízení V-4512/2026 dokončeno, plomba odstraněna</span>
                  <Badge variant="secondary">řízení</Badge>
                </div>
                <span className="text-[13px] text-muted-foreground">Vejprnice 1133/77 · LV 2978</span>
              </div>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">11. 9. 09:30</span>
            </div>
            <div className="px-5 py-3">
              <Button variant="link" className="h-auto p-0">
                Zobrazit všech 27 událostí
              </Button>
            </div>
          </Card>
        </section>

        {/* 05 — Sidebar */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="05 — Sidebar"
            title="Navigace"
            description="Části sidebaru v izolaci. Celý <Sidebar> se v desktopu pozicuje fixně a na mobilu se mění na Sheet, takže patří do shellu aplikace, ne do ukázky. Badge v navigaci nese jednu věc: počet nepřečtených událostí."
          />
          <SidebarProvider className="block min-h-0">
            <div className="max-w-[300px] rounded-md border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
              <SidebarGroup>
                <SidebarGroupLabel>Aplikace</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton isActive>Přehled</SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton>Mapa sledování</SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton>
                        <span className="flex-1 text-left">Sledování</span>
                        <span className="ml-auto text-xs tabular-nums">3</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton>Přehled podle LV</SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton>Nastavení</SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </div>
          </SidebarProvider>
        </section>

        {/* 06 — Breadcrumb, Avatar, DropdownMenu */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="06 — Breadcrumb, Avatar, DropdownMenu"
            title="Hlavička a účet"
            description="Breadcrumb v hlavičce nese cestu Sledování / název objektu. Menu účtu a menu „···“ u akcí objektu používají stejný DropdownMenu."
          />
          <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card px-5 py-4">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">Sledování</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Vejprnice 1133/77</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-3">
              <Avatar>
                <AvatarFallback>PK</AvatarFallback>
              </Avatar>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Účet ⌄
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>user@example.com</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Můj profil</DropdownMenuItem>
                  <DropdownMenuItem>Notifikační kanály</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">Odhlásit se</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        {/* 07 — Input, Label, Tooltip */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="07 — Input, Label, Tooltip"
            title="Formuláře a vysvětlivky"
            description="Doménové zkratky (LV, ISKN, plomba) dostávají tooltip s jednou větou. To je oprava bodu 8 auditu: vysvětlení patří k prvku, ke kterému se vztahuje, ne do odstavce drobného textu."
          />
          <div className="grid gap-5 rounded-md border border-border bg-card p-6 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-lv">Číslo listu vlastnictví</Label>
              <Input id="ds-lv" placeholder="např. 2978" />
              <span className="text-xs text-muted-foreground">
                Najdete jej v levém horním rohu výpisu z katastru.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ds-ku">Katastrální území</Label>
              <Input id="ds-ku" placeholder="Vejprnice" />
              <span className="text-xs text-muted-foreground">Začněte psát název obce.</span>
            </div>
            <div className="flex flex-col items-start gap-2">
              <span className="text-[13px] text-muted-foreground">Tooltip u zkratky</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm">
                      Co je plomba?
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Plomba znamená, že u nemovitosti probíhá řízení a zapsané údaje se
                    mohou změnit.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </section>

        {/* 08 — Skeleton, Separator, Collapsible */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="08 — Skeleton, Separator, Collapsible"
            title="Stavy načítání a skrývání"
            description="Skeleton kopíruje tvar obsahu, který nahrazuje — stat karta i řádek feedu mají svoji verzi. Collapsible zatím zastupuje accordion u částí listu vlastnictví."
          />
          <div className="grid gap-3.5 md:grid-cols-3">
            <Card>
              <CardHeader className="gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-24" />
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
            <div className="flex flex-col gap-3.5 rounded-md border border-border bg-card px-5 py-4">
              <span className="text-[13px] text-muted-foreground">Řádek feedu při načítání</span>
              <div className="flex items-center gap-3">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-3">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>
            <div className="rounded-md border border-border bg-card px-5 py-4">
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between px-3 text-left font-medium">
                    Část C — omezení vlastnického práva
                    <ChevronDown className="size-4 shrink-0" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-1.5 px-3 pt-3 text-[13px]">
                  <span>Zástavní právo smluvní</span>
                  <span className="text-muted-foreground">
                    Zapsáno 4. 3. 2024 · řízení Z-1204/2024
                  </span>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </section>

        {/* 09 — Mezery */}
        <section className="flex flex-col gap-5">
          <SectionHeading
            eyebrow="09 — Mezery"
            title="Co v design systému chybí"
            description="Design systém pokrývá navigaci, karty, badge, formuláře a stavy načítání. Mockupy ale používají i komponenty, které v něm zatím nejsou. Než začne fáze 0, je potřeba je doinstalovat přes shadcn CLI — ne psát vlastní."
          />
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="grid grid-cols-[minmax(120px,150px)_minmax(0,1fr)] divide-x divide-border border-b border-border text-xs font-semibold text-muted-foreground">
              <div className="px-4 py-3">Komponenta</div>
              <div className="px-4 py-3">Kde je potřeba</div>
            </div>
            {missingComponents.map((c) => (
              <div
                key={c.name}
                className="grid grid-cols-[minmax(120px,150px)_minmax(0,1fr)] divide-x divide-border border-b border-border text-sm last:border-b-0"
              >
                <div className="px-4 py-2.5 font-mono text-xs">{c.name}</div>
                <div className="px-4 py-2.5 text-[13.5px]">{c.where}</div>
              </div>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 font-mono text-xs whitespace-pre-wrap break-words">
            npx shadcn@latest add tabs table alert progress accordion switch toggle-group
            checkbox select popover command alert-dialog sonner chart empty pagination
          </pre>
        </section>
      </div>
    </DashboardShell>
  )
}
