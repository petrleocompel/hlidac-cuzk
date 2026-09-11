import { Link, useRouterState } from '@tanstack/react-router'
import {
  Activity,
  Bell,
  ChevronRight,
  KeyRound,
  LayoutDashboard,
  MapPinned,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#/components/ui/sidebar'
import { getNavStats } from '#/server/nav-stats'
import type { LucideIcon } from 'lucide-react'
import type { NavStats } from '#/server/nav-stats'

type NavItem = {
  title: string
  to: string
  icon: LucideIcon
  exact?: boolean
}

const mainNav: NavItem[] = [
  {
    title: 'Sledování',
    to: '/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  {
    title: 'Nová parcela',
    to: '/dashboard/watches/new',
    icon: MapPinned,
  },
  {
    title: 'Notifikace',
    to: '/dashboard/settings',
    icon: Bell,
  },
]

function pathActive(pathname: string, to: string, exact?: boolean) {
  if (exact) return pathname === to || pathname === `${to}/`
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function NavMain({ isAdmin }: { isAdmin?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [stats, setStats] = useState<NavStats | null>(null)
  const adminOpen = pathname.startsWith('/admin')

  useEffect(() => {
    let cancelled = false
    void getNavStats()
      .then((value) => {
        if (!cancelled) setStats(value)
      })
      .catch(() => {
        if (!cancelled) setStats({ watchCount: 0, plombaCount: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Aplikace</SidebarGroupLabel>
        <SidebarMenu>
          {mainNav.map((item) => {
            const active = pathActive(pathname, item.to, item.exact)
            const isWatches = item.to === '/dashboard'
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={
                    isWatches && stats
                      ? `${item.title} · ${stats.watchCount} sledování · ${stats.plombaCount} plomb`
                      : item.title
                  }
                >
                  <Link to={item.to}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {isWatches && stats && stats.watchCount > 0 ? (
                  <SidebarMenuBadge>{stats.watchCount}</SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroup>

      {isAdmin ? (
        <Collapsible defaultOpen={adminOpen} className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel asChild>
              <CollapsibleTrigger className="flex w-full items-center">
                Admin
                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarMenuSub>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    asChild
                    isActive={
                      pathname === '/admin' || pathname.startsWith('/admin/')
                        ? pathname === '/admin' ||
                          pathname.startsWith('/admin/users')
                        : false
                    }
                  >
                    <Link to="/admin" search={{ page: 1 }}>
                      <Users />
                      <span>Uživatelé</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    asChild
                    isActive={pathname.startsWith('/admin/sso')}
                  >
                    <Link to="/admin/sso">
                      <KeyRound />
                      <span>SSO</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
                <SidebarMenuSubItem>
                  <SidebarMenuSubButton
                    asChild
                    isActive={pathname.startsWith('/admin/cuzk')}
                  >
                    <Link to="/admin/cuzk">
                      <Activity />
                      <span>ČÚZK API</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      ) : null}
    </>
  )
}
