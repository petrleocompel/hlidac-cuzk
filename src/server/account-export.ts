import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'

export const downloadAccount = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await requireSession()
    const { exportAccount } = await import('#/lib/account-export')
    return exportAccount(session.user.id)
  },
)
