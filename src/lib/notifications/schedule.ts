export type NotificationChannelName =
  'gotify' | 'slack' | 'discord' | 'ntfy' | 'email'

export type DeliveryRules = {
  timezone: string
  quietFromMinutes: number | null
  quietToMinutes: number | null
  digestMode: 'off' | 'daily' | 'weekly'
  digestHour: number
  /** ISO weekday, 1 = Monday. */
  digestWeekday: number
  urgentKinds: string[]
}

export const DEFAULT_RULES: DeliveryRules = {
  timezone: 'Europe/Prague',
  quietFromMinutes: null,
  quietToMinutes: null,
  digestMode: 'off',
  digestHour: 8,
  digestWeekday: 1,
  urgentKinds: ['new_rizeni', 'lv_change'],
}

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** ISO weekday, 1 = Monday. */
  weekday: number
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  })
}

/** Falls back to Europe/Prague when a stored time zone is no longer valid. */
export function safeTimeZone(timeZone: string): string {
  try {
    formatter(timeZone).format(new Date())
    return timeZone
  } catch {
    return 'Europe/Prague'
  }
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatter(safeTimeZone(timeZone)).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '0'
  const weekday = WEEKDAYS.indexOf(read('weekday')) + 1
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    weekday: weekday > 0 ? weekday : 1,
  }
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  )
  // Compare the wall clock in that zone with the same wall clock read as UTC.
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000
}

/**
 * Converts a wall-clock time in `timeZone` to an instant. Around DST changes the
 * offset is re-checked, so a skipped or repeated local hour still yields a real
 * instant instead of silently shifting by an hour.
 */
export function zonedTimeToUtc(
  timeZone: string,
  parts: {
    year: number
    month: number
    day: number
    hour: number
    minute?: number
  },
): Date {
  const zone = safeTimeZone(timeZone)
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute ?? 0,
  )
  let guess = new Date(wall - offsetMs(new Date(wall), zone))
  for (let i = 0; i < 2; i++) {
    const correction = offsetMs(guess, zone)
    const next = new Date(wall - correction)
    if (next.getTime() === guess.getTime()) break
    guess = next
  }
  // A wall clock inside a spring-forward gap does not exist; use the first
  // instant after the gap so a slot never fires earlier than the user asked.
  const actual = localParts(guess, zone)
  const requested = parts.hour * 60 + (parts.minute ?? 0)
  const reached = actual.hour * 60 + actual.minute
  if (actual.day === parts.day && reached !== requested)
    guess = new Date(guess.getTime() + (requested - reached) * 60_000)
  return guess
}

function minutesOf(parts: LocalParts): number {
  return parts.hour * 60 + parts.minute
}

export function quietHoursActive(rules: DeliveryRules, now: Date): boolean {
  const { quietFromMinutes: from, quietToMinutes: to } = rules
  if (from == null || to == null || from === to) return false
  const minutes = minutesOf(localParts(now, rules.timezone))
  // A window such as 22:00–07:00 wraps past midnight.
  return from < to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to
}

/** Advance calendar dates, not 24-hour instants (DST days can be 23/25 hours). */
function calendarDay(parts: LocalParts, offset: number) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + offset),
  )
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay() || 7,
  }
}

/** Instant when the current quiet window ends; null when it is not active. */
export function quietHoursEnd(rules: DeliveryRules, now: Date): Date | null {
  if (!quietHoursActive(rules, now)) return null
  const to = rules.quietToMinutes!
  const parts = localParts(now, rules.timezone)
  const sameDay = minutesOf(parts) < to
  const target = calendarDay(parts, sameDay ? 0 : 1)
  return zonedTimeToUtc(rules.timezone, {
    year: target.year,
    month: target.month,
    day: target.day,
    hour: Math.floor(to / 60),
    minute: to % 60,
  })
}

/** Next digest slot strictly after `now`; null when digests are off. */
export function nextDigestAt(rules: DeliveryRules, now: Date): Date | null {
  if (rules.digestMode === 'off') return null
  const zone = rules.timezone
  const today = localParts(now, zone)
  for (let offset = 0; offset <= 8; offset++) {
    const day = calendarDay(today, offset)
    if (rules.digestMode === 'weekly' && day.weekday !== rules.digestWeekday)
      continue
    const candidate = zonedTimeToUtc(zone, {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: rules.digestHour,
      minute: 0,
    })
    if (candidate > now) return candidate
  }
  return null
}

export type SendPlan =
  | { mode: 'now' }
  | { mode: 'delayed'; at: Date; reason: 'quiet' }
  | { mode: 'digest'; at: Date }

/**
 * Decides when a captured change may leave the instance. Urgent kinds ignore
 * both the digest and quiet hours; everything else waits instead of being lost.
 */
export function planDelivery(
  rules: DeliveryRules,
  kind: string,
  now: Date,
): SendPlan {
  if (rules.urgentKinds.includes(kind)) return { mode: 'now' }
  const digest = nextDigestAt(rules, now)
  if (digest) return { mode: 'digest', at: digest }
  const quietEnd = quietHoursEnd(rules, now)
  if (quietEnd) return { mode: 'delayed', at: quietEnd, reason: 'quiet' }
  return { mode: 'now' }
}

/** Channels to notify for one watch: configured ∩ selected by the watch. */
export function channelsForWatch(
  configured: NotificationChannelName[],
  selected: string[] | null,
): NotificationChannelName[] {
  if (!selected) return configured
  return configured.filter((channel) => selected.includes(channel))
}

/** A filtered-out kind only skips delivery; the event stays in the history. */
export function kindSelected(kinds: string[] | null, kind: string): boolean {
  return !kinds || kinds.includes(kind)
}
