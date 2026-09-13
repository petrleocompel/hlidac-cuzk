import { eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import { parcelWatches } from '#/db/schema'
import { parseSnapshot } from '#/lib/cuzk/snapshot'
import { summarizeEvent } from '#/lib/notifications/message'

export type PortfolioWatch = {
  id: string
  label: string
  enabled: boolean
  lastSuccessfulCheckAt: string | null
  lastError: string | null
}
export type PortfolioEvent = {
  id: string
  watchId: string
  label: string
  summary: string
  createdAt: string
}
export type PortfolioGroup = {
  key: string
  kuCode: string
  kuName: string
  lvNumber: number | null
  watches: PortfolioWatch[]
  events: PortfolioEvent[]
}

/** Group only this owner's existing watches; this does not query a complete LV. */
export async function readPortfolio(userId: string): Promise<PortfolioGroup[]> {
  const watches = await db.query.parcelWatches.findMany({
    where: eq(parcelWatches.userId, userId),
    orderBy: [parcelWatches.label],
  })
  const groups = new Map<string, PortfolioGroup>()
  const membership: { watch_id: string; group_key: string }[] = []
  const labels = new Map<string, string>()
  for (const watch of watches) {
    const lv = parseSnapshot(watch.lastSnapshotJson)?.parcel.lv
    const kuCode = String(lv?.kuKod ?? watch.kuCode)
    const kuName = lv?.kuNazev ?? watch.kuName
    const number = lv?.cislo ?? null
    const key = `${kuCode}:${number ?? 'unknown'}`
    let group = groups.get(key)
    if (!group) {
      group = { key, kuCode, kuName, lvNumber: number, watches: [], events: [] }
      groups.set(key, group)
    }
    group.watches.push({
      id: watch.id,
      label: watch.label,
      enabled: watch.enabled,
      lastSuccessfulCheckAt: watch.lastSuccessfulCheckAt?.toISOString() ?? null,
      lastError: watch.lastError,
    })
    labels.set(watch.id, watch.label)
    membership.push({ watch_id: watch.id, group_key: key })
  }
  if (!membership.length) return []
  // One bounded query for all feeds; a busy LV cannot hide the others' latest events.
  const events = await db.execute<{
    id: string
    watchId: string
    groupKey: string
    kind: string
    payloadJson: unknown
    createdAt: string
  }>(sql`
    with membership as (
      select * from jsonb_to_recordset(${JSON.stringify(membership)}::jsonb) as m(watch_id uuid, group_key text)
    ), ranked as (
      select e.id, e.watch_id as "watchId", m.group_key as "groupKey", e.kind,
        e.payload_json as "payloadJson", e.created_at::text as "createdAt",
        row_number() over (partition by m.group_key order by e.created_at desc, e.id desc) as position
      from membership m join parcel_watches w on w.id = m.watch_id and w.user_id = ${userId}
      cross join lateral (
        select * from watch_events where watch_id = m.watch_id
        order by created_at desc, id desc limit 10
      ) e
    ) select * from ranked where position <= 10 order by "createdAt" desc, id desc
  `)
  for (const event of events)
    groups.get(event.groupKey)?.events.push({
      id: event.id,
      watchId: event.watchId,
      label: labels.get(event.watchId)!,
      summary: summarizeEvent(event),
      createdAt: new Date(event.createdAt).toISOString(),
    })
  return [...groups.values()].sort(
    (a, b) =>
      a.kuName.localeCompare(b.kuName, 'cs') ||
      a.kuCode.localeCompare(b.kuCode) ||
      (a.lvNumber ?? Infinity) - (b.lvNumber ?? Infinity),
  )
}
