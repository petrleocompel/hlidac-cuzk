import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { FollowInput } from '#/lib/cuzk/rizeni-input'

export type { TrackedRizeniDto } from '#/lib/cuzk/rizeni-dto'

export const followRizeni = createServerFn({ method: 'POST' })
  .inputValidator((v) => FollowInput.parse(v))
  .handler(async ({ data }) => {
    const { followRizeniForUser } = await import('./rizeni.server')
    return followRizeniForUser(data)
  })

const UnfollowInput = z.object({ id: z.string().uuid() })

export const unfollowRizeni = createServerFn({ method: 'POST' })
  .inputValidator((v) => UnfollowInput.parse(v))
  .handler(async ({ data }) => {
    const { unfollowRizeniForUser } = await import('./rizeni.server')
    return unfollowRizeniForUser(data.id)
  })
