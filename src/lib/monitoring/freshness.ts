export function formatCheckTime(value: string | null) {
  if (!value) return 'Dosud nezjištěno'
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) return 'Neznámý čas'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(time)
}

export function dataAge(value: string | null, now: number) {
  if (!value) return 'Bez úspěšných dat'
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000))
  if (!Number.isFinite(minutes)) return 'Neznámé stáří dat'
  if (minutes < 60) return `Stáří dat: ${minutes} min`
  if (minutes < 1440) return `Stáří dat: ${Math.floor(minutes / 60)} h`
  return `Stáří dat: ${Math.floor(minutes / 1440)} dní`
}

export function isWatchStale(
  watch: {
    enabled: boolean
    lastSuccessfulCheckAt: string | null
    createdAt: string
    pollIntervalMinutes: number
  },
  now: number,
) {
  return (
    watch.enabled &&
    now >
      Date.parse(watch.lastSuccessfulCheckAt ?? watch.createdAt) +
        (watch.pollIntervalMinutes + 10) * 60_000
  )
}
