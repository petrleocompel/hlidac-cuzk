// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mapPoint,
  parcelGeometryUrl,
  parcelIdFromFeature,
} from '../src/lib/map/coordinates'
import { loadParcelGeometry } from '../src/lib/map/geometry'

const fixture = (id: string) =>
  `<?xml version="1.0"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:cp="http://inspire.ec.europa.eu/schemas/cp/4.0" xmlns:gml="http://www.opengis.net/gml/3.2"><wfs:member><cp:CadastralParcel gml:id="CP.${id}"><cp:geometry><gml:Polygon srsName="http://www.opengis.net/def/crs/EPSG/0/5514"><gml:exterior><gml:LinearRing><gml:posList>-743303 -1043573 -743308 -1043571 -743318 -1043590 -743303 -1043573</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></cp:geometry><cp:label>279</cp:label><cp:nationalCadastralReference>727024-279</cp:nationalCadastralReference><cp:referencePoint><gml:Point srsName="http://www.opengis.net/def/crs/EPSG/0/5514"><gml:pos>-743305 -1043580</gml:pos></gml:Point></cp:referencePoint></cp:CadastralParcel></wfs:member></wfs:FeatureCollection>`
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('parcel map', () => {
  it('keeps east/north axes and rejects positive JTSK, swapped axes and invalid coordinates', () => {
    expect(mapPoint({ x: -743305.09, y: -1043590.35 })).toEqual([
      -743305.09, -1043590.35,
    ])
    for (const point of [
      null,
      {},
      { x: 743305, y: 1043590 },
      { x: -1043590, y: -743305 },
      { x: NaN, y: -1043590 },
    ])
      expect(mapPoint(point)).toBeNull()
  })
  it('restricts feature identities and geometry queries', () => {
    expect(parcelIdFromFeature('CP.2099039101')).toBe('2099039101')
    for (const id of ['CB.2099039101', 'CP.1&x=2', 'CP.0', 123])
      expect(parcelIdFromFeature(id)).toBeNull()
    expect(() => parcelGeometryUrl({ id: '1&ID=2' })).toThrow()
    const url = new URL(parcelGeometryUrl({ point: [-743305.09, -1043590.35] }))
    expect(url.searchParams.get('POINT')).toContain('-743305.09 -1043590.35')
    expect(url.searchParams.get('count')).toBe('20')
  })
  it('reads the polygon rather than its reference point and caches public data without credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(fixture('101')))
    vi.stubGlobal('fetch', fetcher)
    const result = await loadParcelGeometry(
      { id: '101' },
      new AbortController().signal,
    )
    expect(result.features).toHaveLength(1)
    expect(result.features[0].getGeometry()?.getType()).toBe('Polygon')
    expect(result.features[0].getGeometry()?.getExtent()).toEqual([
      -743318, -1043590, -743303, -1043571,
    ])
    expect(result.features[0].get('nationalCadastralReference')).toBe(
      '727024-279',
    )
    expect(
      await loadParcelGeometry({ id: '101' }, new AbortController().signal),
    ).toMatchObject({ fetchedAt: result.fetchedAt })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
  })
  it('does not highlight a different id returned for the requested parcel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(fixture('999'))),
    )
    expect(
      (await loadParcelGeometry({ id: '102' }, new AbortController().signal))
        .features,
    ).toHaveLength(0)
  })
  it('rejects WFS exceptions, malformed XML and DTD instead of treating them as a missing parcel', async () => {
    for (const [i, text] of [
      '<ExceptionReport><Exception>failure</Exception></ExceptionReport>',
      '<broken',
      '<!DOCTYPE foo><foo/>',
    ].entries()) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text)))
      await expect(
        loadParcelGeometry(
          { id: String(200 + i) },
          new AbortController().signal,
        ),
      ).rejects.toThrow()
    }
  })
  it('limits response size and preserves a failure as retryable', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('a'.repeat(2_000_001)))
      .mockResolvedValueOnce(new Response(fixture('301')))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      loadParcelGeometry({ id: '301' }, new AbortController().signal),
    ).rejects.toThrow('rozsáhlá')
    expect(
      (await loadParcelGeometry({ id: '301' }, new AbortController().signal))
        .features,
    ).toHaveLength(1)
  })
})

it('bounds an area query before network access and uses the geometry BBOX', async () => {
  const url = new URL(
    parcelGeometryUrl({ extent: [-744000, -1044000, -743000, -1043000] }),
  )
  expect(url.searchParams.get('bbox')).toBe(
    '-744000.00,-1044000.00,-743000.00,-1043000.00,http://www.opengis.net/def/crs/EPSG/0/5514',
  )
  expect(url.searchParams.get('typeNames')).toBe('cp:CadastralParcel')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  for (const extent of [
    [-744001, -1044000, -743000, -1043000],
    [-743000, -1044000, -744000, -1043000],
    [-743000, -1044000, -743000, -1043000],
    [-744000, -1044000, NaN, -1043000],
  ]) {
    await expect(
      loadParcelGeometry(
        { extent: extent as [number, number, number, number] },
        new AbortController().signal,
      ),
    ).rejects.toThrow()
  }
  expect(fetcher).not.toHaveBeenCalled()
})
it('rejects a truncated area response even when it contains valid parcels', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          fixture('401').replace(
            '</wfs:FeatureCollection>',
            '<truncatedResponse><ExceptionReport><Exception>too many</Exception></ExceptionReport></truncatedResponse></wfs:FeatureCollection>',
          ),
        ),
      ),
  )
  await expect(
    loadParcelGeometry(
      { extent: [-744000, -1044000, -743000, -1043000] },
      new AbortController().signal,
    ),
  ).rejects.toThrow('neúplný')
})
