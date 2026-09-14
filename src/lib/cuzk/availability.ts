import { CuzkHttpError } from './policy'

/** Only the requested parcel endpoint: a missing řízení is not a missing parcel. */
export function parcelUnavailable(
  error: unknown,
  watch: { objectType: string; isknId: string },
) {
  if (
    watch.objectType !== 'parcel' ||
    !(error instanceof CuzkHttpError) ||
    error.status !== 404 ||
    error.endpoint !== `/api/v1/Parcely/${watch.isknId}`
  )
    return null
  return {
    kind: 'not_found' as const,
    message:
      'Parcela nebyla nalezena v REST API ČÚZK (HTTP 404). To samo nepotvrzuje zánik, rozdělení ani sloučení. Poslední data a historie zůstávají zachované; ověřte stav ve zdroji. Další kontrola proběhne podle intervalu sledování.',
  }
}
