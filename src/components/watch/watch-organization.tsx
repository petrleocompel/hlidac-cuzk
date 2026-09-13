import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { saveOrganization } from '#/server/organization'
import type { WatchDto } from '#/server/watches'

export function WatchOrganization({ watch }: { watch: WatchDto }) {
  const router = useRouter()
  const [label, setLabel] = useState(watch.label)
  const [tags, setTags] = useState(watch.tags.join(', '))
  const [notes, setNotes] = useState(watch.notes)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">
        Vlastní název, štítky a poznámka
      </h2>
      <p className="text-sm text-muted-foreground">
        Štítky a poznámka patří pouze vašemu sledování a neodesílají se do ČÚZK
        ani do notifikací. Vlastní název se používá také v upozorněních.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setMessage('')
          try {
            await saveOrganization({
              data: {
                id: watch.id,
                label,
                notes,
                tags: tags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              },
            })
            setMessage('Uloženo.')
            await router.invalidate()
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : 'Uložení selhalo.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <label className="block text-sm">
          Název
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={200}
          />
        </label>
        <label className="block text-sm">
          Štítky oddělené čárkou (nejvýše 20, každý do 40 znaků)
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            maxLength={840}
          />
        </label>
        <label className="block text-sm">
          Soukromá poznámka
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={5000}
            rows={4}
            className="mt-1 block w-full rounded-md border bg-background p-2 focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
        <Button disabled={busy} type="submit">
          {busy ? 'Ukládám…' : 'Uložit poznámku a štítky'}
        </Button>
        <p role="status" className="text-sm">
          {message}
        </p>
      </form>
    </section>
  )
}
