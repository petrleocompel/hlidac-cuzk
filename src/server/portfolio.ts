import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { readPortfolio } from '#/lib/portfolio'

export const getPortfolio = createServerFn({ method: 'GET' }).handler(
  async () => readPortfolio((await requireSession()).user.id),
)
