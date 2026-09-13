import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { createWatch } from '#/server/watches'
import { objectTypeLabel } from '#/lib/cuzk/object-snapshot'
import type { ObjectType } from '#/lib/cuzk/object-snapshot'

export type WatchedObject = {
  id: string
  objectType: ObjectType
  isknId: string
}

export type LinkedObject = {
  objectType: ObjectType
  isknId: string
  /** What ČÚZK returned about the link; never a locally derived guess. */
  label: string
}

/**
 * Offers the objects the current snapshot links to. Nothing is watched until
 * the user confirms; creation re-verifies the object against ČÚZK.
 */
export function WatchLinkedObjects({
  links,
  watched,
  pollIntervalMinutes,
}: {
  links: LinkedObject[]
  watched: WatchedObject[]
  pollIntervalMinutes: number
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  if (!links.length) return null
  const watchedId = (link: LinkedObject) =>
    watched.find(
      (row) => row.objectType === link.objectType && row.isknId === link.isknId,
    )?.id ?? null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Navázané objekty v katastru
      </p>
      <ul className="space-y-2 text-sm">
        {links.map((link) => {
          const key = `${link.objectType}:${link.isknId}`
          const existing = watchedId(link)
          return (
            <li key={key} className="flex flex-wrap items-center gap-2">
              <span>
                {objectTypeLabel(link.objectType)} {link.label}
              </span>
              {existing ? (
                <Link
                  className="underline"
                  to="/dashboard/watches/$id"
                  params={{ id: existing }}
                >
                  Už sledujete — otevřít
                </Link>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending === key}
                  onClick={async () => {
                    setPending(key)
                    setFeedback(null)
                    try {
                      const created = await createWatch({
                        data: {
                          objectType: link.objectType,
                          isknId: link.isknId,
                          pollIntervalMinutes,
                        },
                      })
                      setFeedback(`Sledování „${created.label}“ bylo založeno.`)
                      await router.invalidate()
                    } catch (error) {
                      setFeedback(
                        error instanceof Error
                          ? error.message
                          : 'Objekt se nepodařilo přidat.',
                      )
                    } finally {
                      setPending(null)
                    }
                  }}
                >
                  {pending === key
                    ? 'Ověřuji v ČÚZK…'
                    : `Sledovat ${objectTypeLabel(link.objectType).toLowerCase()}`}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Každé nové sledování ověří objekt jedním voláním ČÚZK a pak se
        kontroluje samostatně ve svém intervalu.
      </p>
      <p role="status" className="text-xs">
        {feedback}
      </p>
    </div>
  )
}
