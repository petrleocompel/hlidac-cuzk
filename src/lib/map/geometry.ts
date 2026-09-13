import './projection'
import WFS from 'ol/format/WFS.js'
import GML32 from 'ol/format/GML32.js'
import { parcelGeometryUrl, parcelIdFromFeature } from './coordinates'

const cache = new Map<
  string,
  { text: string; expires: number; fetchedAt: string }
>()
/** Browser-only public WFS. No credentials, private labels, or REST API key. */
export async function loadParcelGeometry(
  query: Parameters<typeof parcelGeometryUrl>[0],
  signal: AbortSignal,
) {
  const url = parcelGeometryUrl(query)
  const cached = cache.get(url)
  let text = cached && cached.expires > Date.now() ? cached.text : undefined
  const fetchedAt = text && cached ? cached.fetchedAt : new Date().toISOString()
  if (!text) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok || !response.body)
      throw new Error('Geometrie ČÚZK není dostupná.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    text = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2_000_000) throw new Error('Geometrie je příliš rozsáhlá.')
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      await reader.cancel()
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error('Nepodporovaný formát geometrie.')
  }
  signal.throwIfAborted()
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (
    document.documentElement.localName !== 'FeatureCollection' ||
    document.getElementsByTagName('parsererror').length ||
    document.getElementsByTagNameNS('*', 'Exception').length
  )
    throw new Error('Služba geometrie vrátila chybu nebo neúplný výběr.')
  const features = new WFS({
    version: '2.0.0',
    gmlFormat: new GML32(),
  }).readFeatures(document, {
    dataProjection: 'EPSG:5514',
    featureProjection: 'EPSG:5514',
  })
  if (features.length > 20) throw new Error('Výběr obsahuje více než 20 parcel. Zmenšete výřez.')
  // INSPIRE CP also has referencePoint; OL otherwise selects the last geometry.
  for (const feature of features) feature.setGeometryName('geometry')
  if (cache.size >= 100) cache.delete(cache.keys().next().value!)
  if (!cached || cached.expires <= Date.now())
    cache.set(url, { text, expires: Date.now() + 300000, fetchedAt })
  return {
    features: features.filter(
      (f) =>
        parcelIdFromFeature(f.getId()) &&
        (!('id' in query) || parcelIdFromFeature(f.getId()) === query.id),
    ),
    fetchedAt,
  }
}
