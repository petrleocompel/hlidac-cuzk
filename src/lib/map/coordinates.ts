/** REST KN, WMS and WFS all use EPSG:5514 (east, north, metres). */
export const MAP_EXTENT = [-910000, -1240000, -420000, -920000]
export function mapPoint(value: unknown): [number, number] | null {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as { x?: unknown; y?: unknown }
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    return null
  // Reject unsupported axes/signs; guessing would locate another property.
  if (
    x < MAP_EXTENT[0] ||
    x > MAP_EXTENT[2] ||
    y < MAP_EXTENT[1] ||
    y > MAP_EXTENT[3]
  )
    return null
  return [x, y]
}
export function parcelIdFromFeature(id: unknown): string | null {
  return typeof id === 'string'
    ? (/^CP\.([1-9]\d{0,27})$/.exec(id)?.[1] ?? null)
    : null
}
export const WFS_URL = 'https://services.cuzk.gov.cz/wfs/inspire-cp-wfs.asp'
export type GeometryQuery =
  | { id: string }
  | { point: [number, number] }
  | { extent: [number, number, number, number] }
export function parcelGeometryUrl(query: GeometryQuery): string {
  const url = new URL(WFS_URL)
  const params = url.searchParams
  params.set('service', 'WFS')
  params.set('version', '2.0.0')
  params.set('request', 'GetFeature')
  params.set('srsName', 'http://www.opengis.net/def/crs/EPSG/0/5514')
  params.set('count', '20')
  if ('id' in query) {
    if (!/^[1-9]\d{0,27}$/.test(query.id))
      throw new Error('Neplatné ID parcely.')
    params.set('storedQuery_id', 'GetFeatureById')
    params.set('ID', `CP.${query.id}`)
  } else if ('extent' in query) {
    const [west, south, east, north] = query.extent
    if (
      !mapPoint({ x: west, y: south }) ||
      !mapPoint({ x: east, y: north }) ||
      east <= west ||
      north <= south ||
      east - west > 1000 ||
      north - south > 1000
    )
      throw new Error('Zmenšete výřez mapy nejvýše na 1 × 1 km.')
    params.set('typeNames', 'cp:CadastralParcel')
    params.set(
      'bbox',
      query.extent.map((value) => value.toFixed(2)).join(',') +
        ',http://www.opengis.net/def/crs/EPSG/0/5514',
    )
  } else {
    const [x, y] = query.point
    if (!mapPoint({ x, y })) throw new Error('Bod je mimo podporované území.')
    params.set('storedQuery_id', 'GetFeatureByPoint')
    params.set('FEATURE_TYPE', 'CadastralParcel')
    params.set(
      'POINT',
      `<gml:Point xmlns:gml="http://www.opengis.net/gml/3.2" srsName="http://www.opengis.net/def/crs/EPSG/0/5514"><gml:pos>${x.toFixed(2)} ${y.toFixed(2)}</gml:pos></gml:Point>`,
    )
  }
  return url.href
}
