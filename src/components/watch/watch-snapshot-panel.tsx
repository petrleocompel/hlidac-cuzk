import { ExternalLink } from 'lucide-react'
import type { ParcelSnapshot } from '#/lib/cuzk/snapshot'
import { formatLvLabel, formatParcelNumber } from '#/lib/cuzk/snapshot'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

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

export function WatchSnapshotPanel({
  snapshot,
  lastSuccessfulCheckAt,
  lastError,
  pollIntervalMinutes,
}: {
  snapshot: ParcelSnapshot | null
  lastSuccessfulCheckAt: string | null
  lastError: string | null
  pollIntervalMinutes: number
}) {
  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Aktuální data</CardTitle>
          <CardDescription>Zatím žádný snapshot z ČÚZK</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Spusťte „Načíst teď“, nebo počkejte na další interval cronu.
        </CardContent>
      </Card>
    )
  }

  const p = snapshot.parcel
  const vkladCount = snapshot.rizeni.filter((r) => r.isVklad).length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Přehled parcely</CardTitle>
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
            {vkladCount > 0 ? <Badge>vklad {vkladCount}</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {lastError}
            </p>
          ) : null}
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Parcelní číslo" value={formatParcelNumber(snapshot)} />
            <Fact
              label="Katastrální území"
              value={
                p.kuNazev
                  ? `${p.kuNazev}${p.kuKod != null ? ` (${p.kuKod})` : ''}`
                  : p.kuKod
              }
            />
            <Fact label="ISKN id" value={p.id} />
            <Fact
              label="Typ / číslování"
              value={`${p.typParcely ?? '—'} · ${
                p.druhCislovaniParcely === 1
                  ? 'stavební'
                  : p.druhCislovaniParcely === 2
                    ? 'pozemková'
                    : '—'
              }`}
            />
            <Fact
              label="Výměra"
              value={
                p.vymera != null ? `${p.vymera.toLocaleString('cs')} m²` : null
              }
            />
            <Fact label="Druh pozemku" value={p.druhPozemku} />
            <Fact label="Způsob využití" value={p.zpusobVyuziti} />
            <Fact label="Mapový list" value={p.mapovyList} />
          </dl>
          <a
            href="https://nahlizenidokn.cuzk.gov.cz/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Otevřít Nahlížení do KN (jména vlastníků)
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader>
          <CardTitle>Vlastnictví (LV)</CardTitle>
          <CardDescription>
            Veřejné API ČÚZK neuvádí jména vlastníků. Sledujeme číslo listu
            vlastnictví — jeho změna obvykle znamená převod. Pro konkrétní
            vlastníky použijte Nahlížení do KN.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label="List vlastnictví" value={formatLvLabel(p.lv)} />
            <Fact label="ISKN id LV" value={p.lv?.id} />
            <Fact
              label="KÚ LV"
              value={
                p.lv?.kuNazev
                  ? `${p.lv.kuNazev}${p.lv.kuKod != null ? ` (${p.lv.kuKod})` : ''}`
                  : p.lv?.kuKod
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Další atributy</CardTitle>
          <CardDescription>Ochrana, BPEJ a geometrie</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label="Způsob určení výměry" value={p.zpusobUrceniVymery} />
            <Fact
              label="Definiční bod (S-JTSK)"
              value={
                p.definicniBod
                  ? `Y ${p.definicniBod.y ?? '—'}, X ${p.definicniBod.x ?? '—'}`
                  : null
              }
            />
            <Fact label="Stavba ISKN" value={p.stavbaId} />
            <Fact label="Právo stavby ISKN" value={p.pravoStavbyId} />
          </dl>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Způsoby ochrany
            </p>
            {!p.zpusobyOchrany ? (
              <p className="text-sm text-muted-foreground">
                ČÚZK tento údaj nevrátilo.
              </p>
            ) : p.zpusobyOchrany.length === 0 ? (
              <p className="text-sm text-muted-foreground">žádné</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {p.zpusobyOchrany.map((o) => (
                  <Badge key={o} variant="secondary">
                    {o}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              BPEJ
            </p>
            {!p.bpej ? (
              <p className="text-sm text-muted-foreground">
                ČÚZK tento údaj nevrátilo.
              </p>
            ) : p.bpej.length === 0 ? (
              <p className="text-sm text-muted-foreground">bez BPEJ</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Kód</th>
                      <th className="px-3 py-2 font-medium">Výměra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.bpej.map((b, i) => (
                      <tr key={`${b.kod}-${i}`} className="border-t">
                        <td className="px-3 py-2">{b.kod ?? '—'}</td>
                        <td className="px-3 py-2">
                          {b.vymera != null
                            ? `${b.vymera.toLocaleString('cs')} m²`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
