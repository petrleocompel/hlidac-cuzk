import { ExternalLink } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { formatLvLabel, formatParcelAttrValue } from '#/lib/cuzk/snapshot'
import { objectAttrDefs, objectTypeLabel } from '#/lib/cuzk/object-snapshot'
import type { ObjectSnapshot } from '#/lib/cuzk/object-snapshot'
import { WatchLinkedObjects } from '#/components/watch/watch-linked-objects'
import type { LinkedObject, WatchedObject } from './watch-linked-objects'

/** Links ČÚZK returned for this object, ready for the follow buttons. */
export function objectSnapshotLinks(snapshot: ObjectSnapshot): LinkedObject[] {
  const links = snapshot.object.links
  const label = (attr: string, id: string) => {
    const value = snapshot.object.attrs[attr]
    if (Array.isArray(value)) {
      const hit = (value as string[]).find((entry) => entry.includes(`[${id}]`))
      if (hit) return hit
    }
    return `ISKN ${id}`
  }
  return [
    ...links.parcelIds.map((id) => ({
      objectType: 'parcel' as const,
      isknId: id,
      label: label('parcely', id),
    })),
    ...links.stavbaIds.map((id) => ({
      objectType: 'stavba' as const,
      isknId: id,
      label: label('stavby', id),
    })),
    ...links.jednotkaIds.map((id) => ({
      objectType: 'jednotka' as const,
      isknId: id,
      label: label('jednotky', id),
    })),
    ...(links.pravoStavbyId
      ? [
          {
            objectType: 'pravo_stavby' as const,
            isknId: links.pravoStavbyId,
            label: `ISKN ${links.pravoStavbyId}`,
          },
        ]
      : []),
  ]
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value || '—'}</dd>
    </div>
  )
}

/** Renders a building, unit or right of superficies snapshot. */
export function WatchObjectPanel({
  snapshot,
  lastSuccessfulCheckAt,
  lastError,
  pollIntervalMinutes,
  watchedObjects,
}: {
  snapshot: ObjectSnapshot
  lastSuccessfulCheckAt: string | null
  lastError: string | null
  pollIntervalMinutes: number
  watchedObjects: WatchedObject[]
}) {
  const object = snapshot.object
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>
              {objectTypeLabel(snapshot.objectType)} — {object.summary}
            </CardTitle>
            <CardDescription>
              Poslední načtení{' '}
              {lastSuccessfulCheckAt
                ? new Date(lastSuccessfulCheckAt).toLocaleString('cs')
                : '—'}
              {snapshot.aktualnostDatK
                ? ` · data ČÚZK k ${new Date(snapshot.aktualnostDatK).toLocaleString('cs')}`
                : ''}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="secondary">
              interval {pollIntervalMinutes} min
            </Badge>
            {snapshot.rizeni.length > 0 ? (
              <Badge variant="destructive">
                {snapshot.rizeni.length} plomb
              </Badge>
            ) : (
              <Badge variant="outline">bez plomby</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {lastError}
            </p>
          ) : null}
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="ISKN id" value={object.id} />
            <Fact
              label="Katastrální území"
              value={
                object.kuNazev
                  ? `${object.kuNazev}${object.kuKod != null ? ` (${object.kuKod})` : ''}`
                  : null
              }
            />
            <Fact label="List vlastnictví" value={formatLvLabel(object.lv)} />
            {objectAttrDefs(snapshot.objectType).map((def) => (
              <Fact
                key={def.field}
                label={def.label}
                value={formatParcelAttrValue(
                  def.field,
                  object.attrs[def.field] ?? null,
                )}
              />
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Zobrazují se jen údaje, které pro tento registr vrací veřejné API
            ČÚZK. Jména vlastníků ani úplný list vlastnictví v něm nejsou.
          </p>
          <a
            href="https://nahlizenidokn.cuzk.gov.cz/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Otevřít Nahlížení do KN
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Navázané objekty</CardTitle>
          <CardDescription>
            Vazby podle poslední odpovědi ČÚZK. Sledování se zakládá samostatně,
            aby měl každý objekt vlastní historii i pravidla upozornění.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WatchLinkedObjects
            links={objectSnapshotLinks(snapshot)}
            watched={watchedObjects}
            pollIntervalMinutes={pollIntervalMinutes}
          />
          {objectSnapshotLinks(snapshot).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              ČÚZK u tohoto objektu neuvádí žádnou navázanou nemovitost.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
