import { describe, expect, it } from 'vitest'
import {
  formatRizeniLabel,
  rizeniFingerprint,
} from '../src/lib/cuzk/client'

describe('cuzk helpers', () => {
  it('fingerprints rizeni by id', () => {
    expect(
      rizeniFingerprint([
        { id: 2, poradoveCislo: 1, rok: 2026 },
        { id: 1, poradoveCislo: 2, rok: 2026 },
      ]),
    ).toBe(JSON.stringify(['1', '2']))
  })

  it('formats rizeni label', () => {
    expect(
      formatRizeniLabel({
        id: 1,
        typRizeni: 'V',
        poradoveCislo: 4310,
        rok: 2026,
      }),
    ).toBe('V 4310/2026')
  })
})
