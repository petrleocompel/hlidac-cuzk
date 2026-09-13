import { useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { addNeighbors, getNeighbors } from '#/server/neighbors'
import type { NeighborPreview } from '#/lib/cuzk/neighbor-types'

export function WatchNeighborsPanel({ watchId }: { watchId: string }) {
  const router = useRouter()
  const [preview, setPreview] = useState<NeighborPreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-labelledby="neighbors-title"
    >
      <h2 id="neighbors-title" className="font-semibold">
        Sousední parcely
      </h2>
      <p className="text-sm text-muted-foreground">
        Náhled načte sousedy jedním dotazem ČÚZK. Při uložení je ověříme dalším
        dotazem; opakování při chybě také čerpá denní limit.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMessage('')
          setSelected([])
          try {
            setPreview(await getNeighbors({ data: { watchId } }))
          } catch (error) {
            setPreview(null)
            setMessage(
              error instanceof Error
                ? error.message
                : 'Sousední parcely se nepodařilo načíst.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy
          ? 'Zpracovávám…'
          : preview
            ? 'Obnovit sousedy'
            : 'Vybrat sousední parcely'}
      </Button>
      {preview ? (
        <>
          {preview.parcels.length ? (
            <fieldset disabled={busy} className="space-y-2">
              <legend className="font-medium">
                Vyberte parcely ke sledování
              </legend>
              {preview.parcels.map((parcel) => (
                <div
                  key={parcel.isknId}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(parcel.isknId)}
                      disabled={
                        !!parcel.alreadyWatchedId ||
                        (!selected.includes(parcel.isknId) &&
                          selected.length >=
                            Math.min(
                              preview.selectionLimit,
                              preview.availableSlots,
                            ))
                      }
                      onChange={(event) =>
                        setSelected((values) =>
                          event.target.checked
                            ? [...values, parcel.isknId]
                            : values.filter((id) => id !== parcel.isknId),
                        )
                      }
                    />
                    {parcel.kuName} ({parcel.kuCode}) ·{' '}
                    {parcel.druhCislovani === 1 ? 'st. ' : ''}
                    {parcel.parcelNumber}
                    {parcel.parcelSubdivision
                      ? `/${parcel.parcelSubdivision}`
                      : ''}
                  </label>
                  {parcel.alreadyWatchedId ? (
                    <Link
                      className="underline"
                      to="/dashboard/watches/$id"
                      params={{ id: parcel.alreadyWatchedId }}
                    >
                      Již sledujete
                    </Link>
                  ) : null}
                </div>
              ))}
            </fieldset>
          ) : (
            <p>
              ČÚZK nevrátilo použitelné sousední parcely. Může chybět digitální
              mapa; výsledek nepotvrzuje, že sousedé neexistují.
            </p>
          )}
          {preview.truncated ? (
            <p>
              Zobrazeno prvních {preview.parcels.length} z {preview.total}{' '}
              sousedů.
            </p>
          ) : null}
          {preview.unsupported ? (
            <p>
              {preview.unsupported} záznamů nelze přidat: neúplná identifikace
              nebo nepodporovaná zjednodušená evidence.
            </p>
          ) : null}
          <p className="text-sm">
            Volných míst: {preview.availableSlots}. Najednou lze přidat nejvýše{' '}
            {preview.selectionLimit} parcel.
          </p>
          <p className="text-sm" role="status">
            Vybráno {selected.length} nových sledování s kontrolou jednou denně:
            nejméně +{selected.length} volání API denně z limitu{' '}
            {preview.dailyLimit} pro celou instanci. Detaily řízení a opakování
            mohou spotřebu zvýšit. První snapshot načte worker po uložení.
          </p>
          <p className="text-sm text-muted-foreground">
            Sledování sousedů se dále automaticky nerozšiřuje. Každou parcelu
            můžete samostatně vypnout nebo smazat.
          </p>
          <Button
            disabled={busy || !selected.length}
            onClick={async () => {
              setBusy(true)
              setMessage('')
              try {
                const result = await addNeighbors({
                  data: { watchId, ids: selected },
                })
                setMessage(
                  `Přidáno ${result.created} sledování, již existujících ${result.skipped}.`,
                )
                setSelected([])
                setPreview(null)
                await router.invalidate()
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Sledování se nepodařilo přidat.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Přidat vybrané parcely ({selected.length})
          </Button>
        </>
      ) : null}
      <p role="status" className="text-sm">
        {message}
      </p>
    </section>
  )
}
