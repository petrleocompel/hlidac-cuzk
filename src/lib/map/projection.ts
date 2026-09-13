import Projection from 'ol/proj/Projection.js'
import { addEquivalentProjections } from 'ol/proj.js'
import { MAP_EXTENT } from './coordinates'

// These are names of the same east/north CRS, not transformations or guesses.
const aliases = [
  'EPSG:5514',
  'http://www.opengis.net/def/crs/EPSG/0/5514',
  'urn:ogc:def:crs:EPSG::5514',
]
const projections = aliases.map(
  (code) =>
    new Projection({
      code,
      units: 'm',
      extent: MAP_EXTENT,
      axisOrientation: 'enu',
    }),
)
addEquivalentProjections(projections)
export const cadastralProjection = projections[0]
