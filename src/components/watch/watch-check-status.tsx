import type { WatchDto } from '#/server/watches'
import {
  dataAge,
  formatCheckTime,
  isWatchStale,
} from '#/lib/monitoring/freshness'

export function WatchCheckStatus({
  watch,
  now,
}: {
  watch: WatchDto
  now: number
}) {
  const stale = isWatchStale(watch, now)
  return (
    <section
      aria-label="Stav kontrol"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <h2 className="font-semibold">
        Stav kontrol · {watch.enabled ? 'zapnuto' : 'pozastaveno'}
      </h2>
      <p className={stale ? 'font-medium text-destructive' : 'text-sm'}>
        {dataAge(watch.lastSuccessfulCheckAt, now)}
        {stale
          ? ' · Kontroly se zpožďují, zobrazená data mohou být zastaralá.'
          : ''}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Poslední pokus</dt>
          <dd>{formatCheckTime(watch.lastAttemptAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Poslední úspěšné načtení</dt>
          <dd>{formatCheckTime(watch.lastSuccessfulCheckAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Další plánovaná kontrola</dt>
          <dd>
            {watch.enabled
              ? formatCheckTime(watch.nextCheckAt)
              : 'Sledování je pozastavené'}
          </dd>
        </div>
      </dl>
      {watch.lastError && (
        <p role="status" className="text-sm text-destructive">
          Poslední chyba: {watch.lastError}
        </p>
      )}
    </section>
  )
}
