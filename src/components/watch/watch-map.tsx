import { Component, lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import type { WatchDto } from '#/server/watches'

const ParcelMap = lazy(() => import('./watch-map-canvas'))
class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p role="status">
        Mapu nelze zobrazit. Pokračujte textovým přehledem nebo detailem
        sledování.
      </p>
    ) : (
      this.props.children
    )
  }
}
export function WatchMap({ watches }: { watches: WatchDto[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-label="Mapa sledování"
    >
      <h2 className="text-lg font-semibold">Mapa sledování</h2>
      <p className="text-sm text-muted-foreground">
        Mapové podklady a geometrie se načtou přímo od ČÚZK po otevření mapy.
        Definiční bod není hranice pozemku. Textové údaje zůstávají dostupné i
        bez mapy.
      </p>
      <Button
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? 'Zavřít mapu' : 'Otevřít mapu ČÚZK'}
      </Button>
      {open && (
        <MapBoundary>
          <Suspense fallback={<p role="status">Načítám mapu…</p>}>
            <ParcelMap watches={watches} />
          </Suspense>
        </MapBoundary>
      )}
    </section>
  )
}
