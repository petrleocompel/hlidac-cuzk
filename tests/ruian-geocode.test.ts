import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RuianUnavailableError,
  clearRuianCaches,
  resolveAddressPlaces,
  suggestAddresses,
} from '../src/lib/ruian/geocode'

const BASE = 'http://127.0.0.1:9/arcgis/rest/services/RUIAN/MapServer'

function whereOf(call: string): string | null {
  return new URL(`http://fixture${call}`).searchParams.get('where')
}
let calls: string[] = []
let reply: (url: URL) => { status?: number; body: unknown }

beforeEach(() => {
  process.env.RUIAN_GEOCODE_URL = BASE
  calls = []
  clearRuianCaches()
  reply = () => ({ body: {} })
  vi.stubGlobal('fetch', async (input: URL | string) => {
    const url = new URL(String(input))
    calls.push(url.pathname + '?' + url.searchParams.toString())
    const result = reply(url)
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.RUIAN_GEOCODE_URL
})

describe('address suggestions', () => {
  it('asks only for address places and caches the answer', async () => {
    reply = () => ({
      body: {
        suggestions: [
          {
            text: 'Politických vězňů 123, 33027 Vejprnice',
            magicKey: '1_1',
            type: 'AdresniMisto',
          },
          {
            text: 'Vejprnice 1133/77',
            magicKey: '0_2',
            type: 'ParcelaDefinicniBod',
          },
          { text: 'bez klíče' },
        ],
      },
    })
    const first = await suggestAddresses('Vejprnice 123')
    expect(first).toEqual([
      { text: 'Politických vězňů 123, 33027 Vejprnice', magicKey: '1_1' },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('category=AdresniMisto')
    expect(calls[0]).toContain('maxSuggestions=10')
    await suggestAddresses('Vejprnice 123')
    expect(calls).toHaveLength(1)
  })

  it('does not call the service for a short query', async () => {
    expect(await suggestAddresses('Ve')).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('resolving an address place', () => {
  it('matches the RÚIAN address exactly and returns its code', async () => {
    reply = () => ({
      body: {
        features: [
          {
            attributes: {
              kod: 759678,
              adresa: 'Politických vězňů 123, 33027 Vejprnice',
              cislodomovni: 123,
              cisloorientacni: null,
              psc: 33027,
              stavebniobjekt: 757560,
            },
          },
        ],
      },
    })
    const places = await resolveAddressPlaces(
      'Politických vězňů 123, 33027 Vejprnice',
    )
    expect(places).toEqual([
      {
        kod: 759678,
        adresa: 'Politických vězňů 123, 33027 Vejprnice',
        cisloDomovni: 123,
        cisloOrientacni: null,
        psc: 33027,
        ruianStavebniObjekt: 757560,
      },
    ])
    expect(calls[0]).toContain('returnGeometry=false')
    expect(whereOf(calls[0])).toBe(
      "adresa='Politických vězňů 123, 33027 Vejprnice'",
    )
  })

  it('escapes a quote in the address instead of breaking the query', async () => {
    reply = () => ({ body: { features: [] } })
    await resolveAddressPlaces("Na Hrázi' 1")
    expect(whereOf(calls[0])).toBe("adresa='Na Hrázi'' 1'")
  })

  it('returns every candidate so an ambiguous address can be confirmed', async () => {
    reply = () => ({
      body: {
        features: [
          { attributes: { kod: 1, adresa: 'Dlouhá 1, 11000 Praha' } },
          { attributes: { kod: 2, adresa: 'Dlouhá 1, 11000 Praha' } },
          { attributes: { adresa: 'bez kódu' } },
        ],
      },
    })
    const places = await resolveAddressPlaces('Dlouhá 1, 11000 Praha')
    expect(places.map((place) => place.kod)).toEqual([1, 2])
  })

  it('reports an unavailable service instead of guessing', async () => {
    reply = () => ({ status: 500, body: {} })
    await expect(resolveAddressPlaces('Dlouhá 1')).rejects.toBeInstanceOf(
      RuianUnavailableError,
    )
    reply = () => ({ body: { error: { code: 400 } } })
    clearRuianCaches()
    await expect(suggestAddresses('Dlouhá 1')).rejects.toBeInstanceOf(
      RuianUnavailableError,
    )
  })
})
