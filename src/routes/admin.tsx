import { createFileRoute, redirect } from '@tanstack/react-router'
import { getServerSession } from '#/auth/session'
import { DashboardShell } from '#/components/layout/dashboard-shell'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/admin')({
  loader: async () => {
    const session = await getServerSession()
    if (!session) throw redirect({ to: '/login' })
    if (session.user.role !== 'admin') throw redirect({ to: '/dashboard' })
    return { session }
  },
  component: AdminPage,
})

function AdminPage() {
  const { session } = Route.useLoaderData()
  return (
    <DashboardShell email={session.user.email} isAdmin>
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardDescription>
            Stub — správa uživatelů přijde později.
          </CardDescription>
        </CardHeader>
      </Card>
    </DashboardShell>
  )
}
