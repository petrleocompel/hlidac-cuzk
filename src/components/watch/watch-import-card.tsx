import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { previewWatchImport, runWatchImport } from '#/server/watches'
import { IMPORT_ROW_LIMIT } from '#/lib/cuzk/watch-import'
import type { ImportPlan } from '#/lib/cuzk/watch-import'
import type { ImportOutcome } from '#/lib/cuzk/watch-create'

const STATUS_LABELS: Record<string, string> = {
  ok: 'K importu',
  invalid: 'Chyba',
  duplicate: 'Už sledujete',
  duplicate_in_file: 'Duplicita v souboru',
}

const SAMPLE = `nazev,ku_kod,parcela,interval
Chata u lesa,777552,1133/77,1440
,777552,st. 25,`

export function WatchImportCard() {
  const router = useRouter()
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [content, setContent] = useState('')
  const [plan, setPlan] = useState<(ImportPlan & { error?: string }) | null>(
    null,
  )
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setContent(text)
    setPlan(null)
    setOutcome(null)
    setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv')
  }

  async function onPreview() {
    setBusy(true)
    setMessage(null)
    setOutcome(null)
    try {
      setPlan(await previewWatchImport({ data: { content, format } }))
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Náhled se nepodařilo vytvořit.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onImport() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await runWatchImport({ data: { content, format } })
      setOutcome(result)
      setPlan(null)
      setMessage(
        `Založeno sledování: ${result.created.length}. Nezpracováno: ${result.failed.length}.`,
      )
      await router.invalidate()
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Import se nepodařilo spustit.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hromadný import</CardTitle>
        <CardDescription>
          CSV se záhlavím <code>nazev,ku_kod,parcela,interval</code> (oddělovač
          čárka i středník) nebo JSON se stejnými klíči. Náhled jen kontroluje
          řádky a nespotřebuje žádné volání ČÚZK; teprve import ověří každou
          parcelu jedním dotazem. Najednou nejvýše {IMPORT_ROW_LIMIT} řádků.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="importFile">Soubor</Label>
          <input
            id="importFile"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="block w-full text-sm"
            onChange={(event) => void onFile(event)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="importContent">Nebo vložte obsah</Label>
          <textarea
            id="importContent"
            rows={5}
            className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
            placeholder={SAMPLE}
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setPlan(null)
              setOutcome(null)
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="importFormat" className="text-xs">
              Formát
            </Label>
            <select
              id="importFormat"
              value={format}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              onChange={(event) =>
                setFormat(event.target.value === 'json' ? 'json' : 'csv')
              }
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || content.trim() === ''}
            onClick={() => void onPreview()}
          >
            {busy ? 'Pracuji…' : 'Zkontrolovat náhled'}
          </Button>
          <Button
            type="button"
            disabled={busy || !plan?.ready}
            onClick={() => void onImport()}
          >
            {plan?.ready
              ? `Importovat ${plan.ready} parcel (${plan.apiCalls} volání ČÚZK)`
              : 'Importovat'}
          </Button>
        </div>

        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}

        {plan?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {plan.error}
          </p>
        ) : null}

        {plan && !plan.error ? (
          <div className="space-y-2">
            <p className="text-sm">
              K importu: {plan.ready} · přeskočeno: {plan.skipped}
            </p>
            <ul className="space-y-1 text-xs">
              {plan.rows.map((row) => (
                <li key={row.line} className="flex flex-wrap gap-2">
                  <Badge
                    variant={
                      row.status === 'ok'
                        ? 'default'
                        : row.status === 'invalid'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    řádek {row.line} · {STATUS_LABELS[row.status]}
                  </Badge>
                  <span>
                    {row.candidate
                      ? `${row.candidate.label} · KÚ ${row.candidate.kuCode} · ${
                          row.candidate.druhCislovani === 1 ? 'st. ' : ''
                        }${row.candidate.kmenoveCisloParcely}${
                          row.candidate.poddeleniCislaParcely != null
                            ? `/${row.candidate.poddeleniCislaParcely}`
                            : ''
                        } · ${row.candidate.pollIntervalMinutes} min`
                      : row.raw || '(prázdný řádek)'}
                  </span>
                  {row.message ? (
                    <span className="text-muted-foreground">{row.message}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {outcome ? (
          <div className="space-y-2 text-xs">
            {outcome.stoppedReason ? (
              <p className="text-destructive">
                Import se zastavil: {outcome.stoppedReason}
              </p>
            ) : null}
            {outcome.created.length ? (
              <div>
                <p className="font-medium">Založeno</p>
                <ul>
                  {outcome.created.map((row) => (
                    <li key={row.watchId}>
                      řádek {row.line}: {row.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                  První snapshot doplní nejbližší kontrola.
                </p>
              </div>
            ) : null}
            {outcome.failed.length ? (
              <div>
                <p className="font-medium text-destructive">Nezpracováno</p>
                <ul>
                  {outcome.failed.map((row) => (
                    <li key={row.line}>
                      řádek {row.line}: {row.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
