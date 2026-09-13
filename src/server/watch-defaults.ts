import { createServerFn } from '@tanstack/react-start'
import { requireSession } from '#/auth/session'
import { DEMO_WATCH } from '#/db/seed-demo-watch'

export type NewWatchDefaults = {
  /** Demo values are prefilled only when the instance runs in demo mode. */
  demo: boolean
  demoKuCode: string
  demoKuName: string
  demoParcel: string
}

export const getNewWatchDefaults = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NewWatchDefaults> => {
    await requireSession()
    const demo = process.env.SEED_DEMO_WATCH === '1'
    return {
      demo,
      demoKuCode: demo ? DEMO_WATCH.kuCode : '',
      demoKuName: demo ? DEMO_WATCH.kuName : '',
      demoParcel: demo
        ? `${DEMO_WATCH.parcelNumber}/${DEMO_WATCH.parcelSubdivision}`
        : '',
    }
  },
)
