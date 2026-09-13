import {
  formatLvLabel,
  formatRizeniHeadline,
  stavUhradyLabel,
} from '#/lib/cuzk/snapshot'
import type { SnapshotChange } from '#/lib/cuzk/snapshot'

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
    } else {
      lines.push(`Změna atributů parcely: ${change.fields.join(', ')}`)
    }
  }
  return lines.join('\n')
}
