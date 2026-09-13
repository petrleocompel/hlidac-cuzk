import type { GeometryQuery } from '#/lib/map/coordinates'
import { cadastralProjection as projection } from '#/lib/map/projection'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import TileWMS from 'ol/source/TileWMS.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle, Fill, Stroke, Style } from 'ol/style.js'
import { defaults as controls } from 'ol/control/defaults.js'
import { Button } from '#/components/ui/button'
import {
  mapPoint,
  MAP_EXTENT,
  parcelIdFromFeature,
} from '#/lib/map/coordinates'
import { loadParcelGeometry } from '#/lib/map/geometry'
import {
  isObjectSnapshot,
  parseWatchSnapshot,
} from '#/lib/cuzk/object-snapshot'
import { WatchLinkedObjects } from './watch-linked-objects'
import type { WatchDto } from '#/server/watches'
import 'ol/ol.css'

const highlight = new Style({
  stroke: new Stroke({ color: '#d97706', width: 3 }),
  fill: new Fill({ color: 'rgba(217,119,6,0.18)' }),
  image: new Circle({
    radius: 6,
    fill: new Fill({ color: '#d97706' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
})

export default function WatchMapCanvas({ watches }: { watches: WatchDto[] }) {
  const target = useRef<HTMLDivElement>(null)
  const api = useRef<{
    map: Map
    ortho: TileLayer<TileWMS>
    kn: TileWMS
    select: (query: GeometryQuery) => Promise<void>
  } | null>(null)
  const watchesRef = useRef(watches)
  watchesRef.current = watches
  const [message, setMessage] = useState(
    'Vyberte sledování v seznamu, nebo přibližte mapu a klikněte na parcelu.',
  )
  const [ortho, setOrtho] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<
    Array<{ objectType: 'parcel'; isknId: string; label: string }>
  >([])
  useEffect(() => {
    if (!target.current) return
    let alive = true
    let request: AbortController | null = null
    const points = new VectorSource()
    for (const w of watchesRef.current) {
      const s = parseWatchSnapshot(w.lastSnapshotJson)
      const point =
        s &&
        mapPoint(
          isObjectSnapshot(s) ? s.object.definicniBod : s.parcel.definicniBod,
        )
      if (point)
        points.addFeature(
          new Feature({ geometry: new Point(point), watchId: w.id }),
        )
    }
    const geometry = new VectorSource()
    const kn = new TileWMS({
      url: 'https://services.cuzk.gov.cz/wms/local-km-wms.asp',
      params: { LAYERS: 'KN', VERSION: '1.3.0', FORMAT: 'image/png' },
      attributions: '© ČÚZK — katastrální mapa',
    })
    const aerial = new TileWMS({
      url: 'https://ags.cuzk.gov.cz/arcgis1/services/ORTOFOTO/MapServer/WMSServer',
      params: { LAYERS: '0', VERSION: '1.3.0', FORMAT: 'image/jpeg' },
      attributions: '© ČÚZK — Ortofoto ČR',
    })
    for (const source of [kn, aerial])
      source.on('tileloaderror', () => {
        if (alive)
          setMessage(
            'Mapový podklad se nepodařilo načíst. Textové údaje a výběr sledování jsou stále dostupné.',
          )
      })
    const orthoLayer = new TileLayer({ source: aerial, visible: false })
    const map = new Map({
      target: target.current,
      controls: controls({
        attributionOptions: { collapsible: false },
        zoomOptions: {
          zoomInTipLabel: 'Přiblížit',
          zoomOutTipLabel: 'Oddálit',
        },
      }),
      layers: [
        orthoLayer,
        new TileLayer({ source: kn }),
        new VectorLayer({ source: geometry, style: highlight }),
        new VectorLayer({ source: points, style: highlight }),
      ],
      view: new View({
        projection,
        center: [-670000, -1080000],
        resolution: 700,
        minResolution: 0.1,
        maxResolution: 2000,
        extent: MAP_EXTENT,
      }),
      keyboardEventTarget: target.current,
    })
    if (points.getFeatures().length)
      map.getView().fit(points.getExtent()!, {
        padding: [50, 50, 50, 50],
        maxZoom: 18,
        minResolution: 1,
      })
    const select = async (query: GeometryQuery) => {
      request?.abort()
      const current = new AbortController()
      request = current
      setBusy(true)
      setSelected([])
      geometry.clear()
      setMessage('Načítám geometrii parcely…')
      try {
        const result = await loadParcelGeometry(query, current.signal)
        if (!alive || current.signal.aborted) return
        const polygons = result.features.filter((f) =>
          ['Polygon', 'MultiPolygon'].includes(
            f.getGeometry()?.getType() ?? '',
          ),
        )
        geometry.addFeatures(polygons)
        setSelected(
          polygons.map((f) => ({
            objectType: 'parcel',
            isknId: parcelIdFromFeature(f.getId())!,
            label: String(
              f.get('nationalCadastralReference') ??
                f.get('label') ??
                f.getId(),
            ),
          })),
        )
        if (polygons.length) {
          if ('id' in query)
            map.getView().fit(geometry.getExtent()!, {
              padding: [40, 40, 40, 40],
              minResolution: 0.5,
            })
          setMessage(
            `Geometrie INSPIRE CP načtena ${new Date(result.fetchedAt).toLocaleString('cs')}. Výběr kliknutím může zahrnout nejbližší parcelu; před přidáním ověřte číslo a zvýrazněnou hranici. Datum načtení není datum poslední změny parcely.`,
          )
        } else
          setMessage(
            'Geometrie parcely není dostupná. To nepotvrzuje zánik parcely; definiční bod a textová data zůstávají zachované.',
          )
      } catch (error) {
        if (alive && !current.signal.aborted)
          setMessage(
            error instanceof Error ? error.message : 'Geometrii nelze načíst.',
          )
      } finally {
        if (alive && !current.signal.aborted) setBusy(false)
      }
    }
    map.on('singleclick', (event) => {
      if ((map.getView().getResolution() ?? 1000) > 5) {
        setMessage('Pro výběr parcely mapu nejprve přibližte.')
        return
      }
      void select({ point: [event.coordinate[0], event.coordinate[1]] })
    })
    api.current = { map, kn, ortho: orthoLayer, select }
    if (
      watchesRef.current.length === 1 &&
      watchesRef.current[0].objectType === 'parcel'
    )
      void select({ id: watchesRef.current[0].isknId })
    return () => {
      alive = false
      request?.abort()
      api.current = null
      map.setTarget(undefined)
      map.dispose()
    }
  }, [])
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ortho}
          onChange={(e) => {
            setOrtho(e.target.checked)
            api.current?.ortho.setVisible(e.target.checked)
            api.current?.kn.updateParams({
              LAYERS: e.target.checked ? 'KN_I' : 'KN',
            })
          }}
        />
        Ortofoto
      </label>
      <div
        ref={target}
        tabIndex={0}
        role="region"
        aria-label="Mapa ČÚZK. Šipky posouvají mapu, plus a minus mění přiblížení."
        className="h-96 w-full rounded-md border bg-white text-black focus-visible:outline-2 focus-visible:outline-ring"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          const view = api.current?.map.getView()
          const center = view?.getCenter()
          if (!center || (view?.getResolution() ?? 1000) > 5) {
            setMessage('Pro výběr parcely mapu nejprve přibližte.')
            return
          }
          void api.current?.select({ point: [center[0], center[1]] })
        }}
      >
        Vybrat parcelu uprostřed mapy
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => {
          const current = api.current
          if (!current) return
          const extent = current.map
            .getView()
            .calculateExtent(current.map.getSize())
          void current.select({
            extent: [extent[0], extent[1], extent[2], extent[3]],
          })
        }}
      >
        Vybrat parcely v zobrazeném výřezu
      </Button>
      <p className="text-xs text-muted-foreground">
        Výběr oblasti: nejvýše 1 × 1 km a 20 parcel. Jde o průnik geometrie s
        výřezem, i parcela přesahující okraj může být zahrnuta. Při překročení
        limitu výřez zmenšete. Nabídnuté parcely přidáváte jednotlivě; mapa sama
        nové odběry nezaloží.
      </p>
      <p role="status" className="text-sm">
        {message}
      </p>
      <p className="text-xs text-muted-foreground">
        Zvýraznění: oranžová hranice = polygon parcely, kolečko = definiční bod.
        Podklad je aktuálně poskytovaná mapa ČÚZK; datum pořízení ortofota se
        může lišit podle místa. Mapové služby nečerpají limit REST KN 500
        volání/den. Nové sledování má denní interval a každá jeho kontrola
        spotřebuje nejméně jedno volání.
      </p>
      <WatchLinkedObjects
        links={selected}
        watched={watches}
        pollIntervalMinutes={1440}
        heading="Parcely vybrané v mapě"
      />
      <ul
        className="max-h-64 space-y-2 overflow-auto text-sm"
        aria-label="Sledované objekty v mapě"
      >
        {watches.map((w) => {
          const snapshot = parseWatchSnapshot(w.lastSnapshotJson)
          const point =
            snapshot &&
            mapPoint(
              isObjectSnapshot(snapshot)
                ? snapshot.object.definicniBod
                : snapshot.parcel.definicniBod,
            )
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-2">
              <Link
                to="/dashboard/watches/$id"
                params={{ id: w.id }}
                className="underline"
              >
                {w.label}
              </Link>
              {w.objectType === 'parcel' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void api.current?.select({ id: w.isknId })}
                >
                  Zvýraznit parcelu
                </Button>
              ) : point ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    api.current?.map.getView().setCenter(point)
                    api.current?.map.getView().setResolution(1)
                  }}
                >
                  Zobrazit bod
                </Button>
              ) : (
                <span className="text-muted-foreground">Bez známé polohy</span>
              )}
              <span className="text-xs text-muted-foreground">
                Údaje KN k {snapshot?.aktualnostDatK ?? 'neznámému datu'}
              </span>
            </li>
          )
        })}
      </ul>
      <Link className="text-sm underline" to="/dashboard/watches/new">
        Přidat podle adresy nebo čísla bez mapy
      </Link>
    </div>
  )
}
