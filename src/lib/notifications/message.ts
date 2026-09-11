import { formatLvLabel, formatRizeniHeadline } from '#/lib/cuzk/snapshot'
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
        lines.push('Odstraněné plomby:')
        for (const r of change.removed) {
          lines.push(`• ${formatRizeniHeadline(r)}`)
        }
      }
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
