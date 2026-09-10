import { describe, expect, it } from 'vitest'
import { rizeniFingerprint } from '../src/lib/cuzk/client'

describe('rizeniFingerprint', () => {
  it('is order-independent', () => {
    expect(
      rizeniFingerprint([
        { id: 2 },
        { id: 1 },
      ]),
    ).toBe(rizeniFingerprint([{ id: 1 }, { id: 2 }]))
  })
})
