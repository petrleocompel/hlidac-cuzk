/** TypyRizeni code list from the ČÚZK OpenAPI contract (UI-safe, no HTTP). */
export const TYPY_RIZENI = ['V', 'Z', 'PGP', 'PD', 'ZPV'] as const
export type TypRizeni = (typeof TYPY_RIZENI)[number]

export function formatRizeniLabel(r: {
  id?: number | string
  poradoveCislo?: number
  rok?: number
  typRizeni?: string | { kod?: string; nazev?: string } | null
  [key: string]: unknown
}): string {
  const cislo = r.poradoveCislo ?? '?'
  const rok = r.rok ?? '?'
  const typ =
    typeof r.typRizeni === 'string'
      ? r.typRizeni
      : (r.typRizeni?.kod ?? r.typRizeni?.nazev ?? '')
  return typ ? `${typ} ${cislo}/${rok}` : `${cislo}/${rok}`
}
