export const THEME_STORAGE_KEY = 'hlidac-theme'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'dark'
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function applyThemeClass(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

/**
 * Inline script for <head> — prevents light flash before React hydrates.
 * A static literal with no interpolation; tests keep the key in sync with
 * THEME_STORAGE_KEY.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('hlidac-theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`
