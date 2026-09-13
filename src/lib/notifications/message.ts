import {
  formatLvLabel,
  formatParcelAttrValue,
  formatRizeniHeadline,
  parcelAttrLabel,
  parseSnapshotChange,
  stavUhradyLabel,
} from '#/lib/cuzk/snapshot'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'

/** Public origin of this instance, if the admin configured one. */
function appBaseUrl(): string | null {
  const value = process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_URL
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** Deep link to the event in the history; empty when no public URL is set. */
export function eventLink(watchId: string, eventId: string): string {
  const base = appBaseUrl()
  if (!base) return ''
  return `Detail: ${base}/dashboard/watches/${watchId}?event=${eventId}#event-${eventId}`
}

export function describeChanges(changes: SnapshotChange[]): string {
  const lines: string[] = []
  for (const change of changes) {
    if (change.kind === 'new_rizeni') {
      if (change.added.length > 0) {
        lines.push('Nová řízení / plomby:')
        for (const r of change.added) {
          const mark = r.isVklad ? ' (vklad — možné vlastnictví)' : ''
          lines.push(`• ${formatRizeniHeadline(r)}${mark}`)
        }
      }
      if (change.removed.length > 0) {
        lines.push(
          'Odstraněné plomby (samo o sobě nepotvrzuje schválení vkladu):',
        )
        for (const r of change.removed) {
          lines.push(`• ${formatRizeniHeadline(r)}`)
        }
      }
    } else if (change.kind === 'rizeni_progress') {
      lines.push(`Průběh řízení: ${formatRizeniHeadline(change.next)}`)
      if (change.followed)
        lines.push('Řízení už není plombou na parcele; sledujeme jeho detail.')
      if (change.fields.includes('stav'))
        lines.push(
          `Stav: ${change.previous.stav ?? 'neznámý'} → ${change.next.stav ?? 'neznámý'}`,
        )
      if (change.fields.includes('stavUhrady'))
        lines.push(
          `Úhrada: ${stavUhradyLabel(change.previous.stavUhrady)} → ${stavUhradyLabel(change.next.stavUhrady)}`,
        )
      for (const op of change.addedOperations)
        lines.push(
          `Nová operace: ${op.nazev}${op.datumProvedeni ? ` (${op.datumProvedeni})` : ''}`,
        )
    } else if (change.kind === 'lv_change') {
      lines.push(
        `Změna LV (indikátor vlastnictví): ${formatLvLabel(change.previous)} → ${formatLvLabel(change.next)}`,
      )
    } else if (change.values?.length) {
      lines.push('Změna atributů parcely:')
      for (const value of change.values)
        lines.push(
          `• ${parcelAttrLabel(value.field)}: ${formatParcelAttrValue(value.field, value.previous)} → ${formatParcelAttrValue(value.field, value.next)}`,
        )
    } else {
      lines.push(`Změna atributů parcely: ${change.fields.join(', ')}`)
    }
  }
  return lines.join('\n')
}

/** One-line description for history exports; never invents a missing payload. */
export function summarizeEvent(event: {
  kind: string
  payloadJson: unknown
}): string {
  if (event.kind === 'error') {
    const payload = event.payloadJson
    return payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : 'Kontrola selhala.'
  }
  const change = parseSnapshotChange(event.payloadJson)
  return change
    ? describeChanges([change]).replaceAll('\n', ' | ')
    : `Neznámý typ události: ${event.kind}`
}
