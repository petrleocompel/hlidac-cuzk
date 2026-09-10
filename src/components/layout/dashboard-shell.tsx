import { AppSidebar } from '#/components/layout/app-sidebar'
import type { ShellUser } from '#/components/layout/nav-user'
import { SiteHeader } from '#/components/layout/site-header'
import { SidebarInset, SidebarProvider } from '#/components/ui/sidebar'

export function DashboardShell({
  children,
  user,
  isAdmin,
}: {
  children: React.ReactNode
  user: ShellUser
  isAdmin?: boolean
}) {
  return (
    <SidebarProvider>
      <AppSidebar user={user} isAdmin={isAdmin} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
