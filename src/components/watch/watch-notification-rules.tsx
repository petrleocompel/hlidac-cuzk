import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { updateWatch } from '#/server/watches'
import type { WatchDto } from '#/server/watches'
import { Button } from '#/components/ui/button'

const kinds = [
  ['new_rizeni', 'Plomby'],
  ['rizeni_progress', 'Průběh řízení'],
  ['lv_change', 'Změna LV'],
  ['parcel_attrs', 'Atributy parcely'],
] as const
const channels = ['gotify', 'slack', 'discord', 'ntfy', 'email'] as const
export function WatchNotificationRules({ watch }: { watch: WatchDto }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  return (
    <form
      className="space-y-3 rounded-xl border p-4"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        setBusy(true)
        try {
          await updateWatch({
            data: {
              id: watch.id,
              notifyKinds: form.has('allKinds')
                ? null
                : (form.getAll('kinds').map(String) as Array<
                    (typeof kinds)[number][0]
                  >),
              notifyChannels: form.has('allChannels')
                ? null
                : (form.getAll('channels').map(String) as Array<
                    (typeof channels)[number]
                  >),
            },
          })
          await router.invalidate()
          setFeedback('Pravidla uložena. Platí pro nově zachycené změny.')
        } catch {
          setFeedback('Pravidla se nepodařilo uložit.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <h2 className="font-semibold">Upozornění pro toto sledování</h2>
      <p className="text-sm text-muted-foreground">
        Filtr mění pouze doručování. Všechny změny zůstávají v historii. Klidové
        hodiny a souhrny nastavíte v Notifikacích.
      </p>
      <fieldset disabled={busy} className="space-y-2">
        <legend>Typy změn</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allKinds"
            defaultChecked={watch.notifyKinds === null}
          />
          Všechny typy (má přednost před výběrem)
        </label>
        {kinds.map(([kind, label]) => (
          <label className="flex items-center gap-2" key={kind}>
            <input
              type="checkbox"
              name="kinds"
              value={kind}
              defaultChecked={watch.notifyKinds?.includes(kind)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy} className="space-y-2">
        <legend>Kanály</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="allChannels"
            defaultChecked={watch.notifyChannels === null}
          />
          Všechny nakonfigurované kanály (má přednost před výběrem)
        </label>
        {channels.map((channel) => (
          <label className="flex items-center gap-2" key={channel}>
            <input
              type="checkbox"
              name="channels"
              value={channel}
              defaultChecked={watch.notifyChannels?.includes(channel)}
            />
            {channel === 'email' ? 'E-mail' : channel}
          </label>
        ))}
      </fieldset>
      <p className="text-sm">
        Prázdný výběr bez „všechny“ doručování vypne. Kanály nejprve nastavte ve
        svém účtu.
      </p>
      <Button disabled={busy}>Uložit pravidla sledování</Button>
      <p role="status">{feedback}</p>
    </form>
  )
}
