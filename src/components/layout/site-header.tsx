import { Link, useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { ThemeToggle } from '#/components/theme-toggle'
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
import { Separator } from '#/components/ui/separator'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { getNavStats } from '#/server/nav-stats'
import type { NavStats } from '#/server/nav-stats'

type Crumb = {
  label: string
  to?: '/dashboard' | '/admin' | '/dashboard/settings' | '/dashboard/account'
}

function crumbsForPath(pathname: string): Crumb[] {
  if (pathname.startsWith('/admin/users/')) {
    return [
      { label: 'Admin', to: '/admin' },
      { label: 'Uživatelé', to: '/admin' },
      { label: 'Detail' },
    ]
  }
  if (pathname.startsWith('/admin/monitoring')) {
    return [{ label: 'Admin', to: '/admin' }, { label: 'Stav workeru' }]
  }
  if (pathname.startsWith('/admin/cuzk')) {
    return [{ label: 'Admin', to: '/admin' }, { label: 'ČÚZK API' }]
  }
  if (pathname.startsWith('/admin')) {
    return [{ label: 'Admin', to: '/admin' }, { label: 'Uživatelé' }]
  }
  if (pathname.startsWith('/dashboard/watches/new')) {
    return [{ label: 'Sledování', to: '/dashboard' }, { label: 'Nová parcela' }]
  }
  if (pathname.startsWith('/dashboard/watches/')) {
    return [
      { label: 'Sledování', to: '/dashboard' },
      { label: 'Detail parcely' },
    ]
  }
  if (pathname.startsWith('/dashboard/settings')) {
    return [{ label: 'Notifikace' }]
  }
  if (pathname.startsWith('/dashboard/account')) {
    return [{ label: 'Účet' }]
  }
  if (pathname.startsWith('/dashboard')) {
    return [{ label: 'Sledování' }]
  }
  return [{ label: 'Hlídač ČÚZK' }]
}

export function SiteHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const crumbs = crumbsForPath(pathname)
  const [stats, setStats] = useState<NavStats | null>(null)

  useEffect(() => {
    let cancelled = false
    void getNavStats()
      .then((value) => {
        if (!cancelled) setStats(value)
      })
      .catch(() => {
        if (!cancelled) setStats(null)
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 ? <BreadcrumbSeparator /> : null}
                  <BreadcrumbItem>
                    {last || !crumb.to ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : crumb.to === '/admin' ? (
                      <BreadcrumbLink asChild>
                        <Link to="/admin" search={{ page: 1 }}>
                          {crumb.label}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.to}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          {stats && stats.plombaCount > 0 ? (
            <Badge
              variant="outline"
              className="hidden border-warning-border bg-warning text-warning-foreground sm:inline-flex"
            >
              {stats.plombaCount} {stats.plombaCount === 1 ? 'plomba' : 'plomb'}
            </Badge>
          ) : null}
          <ThemeToggle compact />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/dashboard/watches/new">
              <Plus className="size-4" />
              Nová parcela
            </Link>
          </Button>
          <Button
            asChild
            size="icon"
            className="sm:hidden"
            aria-label="Nová parcela"
          >
            <Link to="/dashboard/watches/new">
              <Plus className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
