import { Link } from '@tanstack/react-router'
import {
  Bell,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Settings,
  Shield,
} from 'lucide-react'
import { authClient } from '#/auth/client'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

const nav = [
  { to: '/dashboard', label: 'Sledování', icon: LayoutDashboard },
  { to: '/dashboard/watches/new', label: 'Nová parcela', icon: MapPinned },
  { to: '/dashboard/settings', label: 'Notifikace', icon: Bell },
  { to: '/admin', label: 'Admin', icon: Shield },
] as const

export function DashboardShell({
  children,
  email,
  isAdmin,
}: {
  children: React.ReactNode
  email?: string | null
  isAdmin?: boolean
}) {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <MapPinned className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Hlídač ČÚZK</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav
            .filter((item) => item.to !== '/admin' || isAdmin)
            .map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&.active]:bg-accent [&.active]:font-medium [&.active]:text-foreground',
                )}
                activeOptions={{ exact: item.to === '/dashboard' }}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="border-t p-3">
          <p className="mb-2 truncate px-2 text-xs text-muted-foreground">
            {email}
          </p>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => { window.location.href = '/login' } } })}
          >
            <LogOut className="h-4 w-4" />
            Odhlásit
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
          <span className="font-semibold">Hlídač ČÚZK</span>
          <Link to="/dashboard/settings">
            <Settings className="h-5 w-5" />
          </Link>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  )
}
