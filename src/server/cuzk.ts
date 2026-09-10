import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSession } from '#/auth/session'
import { searchKatastralniUzemi } from '#/lib/cuzk/client'

const SearchKuInput = z.object({
  query: z.string().min(2).max(100),
})

export const searchKu = createServerFn({ method: 'GET' })
  .inputValidator((v) => SearchKuInput.parse(v))
  .handler(async ({ data }) => {
    await requireSession()
    const rows = await searchKatastralniUzemi(data.query)
    return rows.map((ku) => ({
      kod: String(ku.kod),
      nazev: ku.nazev,
    }))
  })
