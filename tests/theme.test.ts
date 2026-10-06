import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, themeInitScript } from '../src/lib/theme'

function runInit(stored: string | null, prefersDark = false) {
  const classes = new Set<string>()
  const root = {
    classList: {
      toggle: (name: string, on: boolean) =>
        on ? classes.add(name) : classes.delete(name),
    },
    style: { colorScheme: '' },
  }
  const reads: string[] = []
  runInNewContext(themeInitScript, {
    localStorage: {
      getItem: (key: string) => (reads.push(key), stored),
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
    document: { documentElement: root },
  })
  return { dark: classes.has('dark'), scheme: root.style.colorScheme, reads }
}

describe('theme init script', () => {
  it('reads the same storage key as the React theme provider', () => {
    expect(runInit(null).reads).toEqual([THEME_STORAGE_KEY])
  })
  it('applies stored, system and fallback preferences', () => {
    expect(runInit('light')).toMatchObject({ dark: false, scheme: 'light' })
    expect(runInit('dark')).toMatchObject({ dark: true, scheme: 'dark' })
    expect(runInit('system', true)).toMatchObject({ dark: true })
    expect(runInit('system', false)).toMatchObject({ dark: false })
    expect(runInit('bogus')).toMatchObject({ dark: true, scheme: 'dark' })
  })
})
