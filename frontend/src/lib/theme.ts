/**
 * The visitor's theme (B5): Dark, Light, or System (whatever the device is set to). Dark is the
 * default, for anyone who has not chosen. The choice is kept in this browser only (localStorage), and
 * a browser that refuses storage (a private window, blocked site data) simply gets the default each
 * visit rather than an error.
 *
 * public/theme-init.js applies the same rules before the first paint, so the page never flashes the
 * wrong theme; tests/theme.test.ts runs both and checks they agree.
 */

export type ThemePreference = 'dark' | 'light' | 'system'
export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'zyro-theme'
export const DEFAULT_PREFERENCE: ThemePreference = 'dark'

/** The colour the browser's own chrome (the address bar on a phone) takes in each theme: the page's. */
export const THEME_COLOR: Record<Theme, string> = { dark: '#030407', light: '#f4f5f0' }

export function parsePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system' ? value : DEFAULT_PREFERENCE
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === 'system') return systemPrefersLight ? 'light' : 'dark'
  return preference
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** The saved choice, or the default when there is none or storage cannot be read. */
export function readPreference(storage: () => Store | null | undefined): ThemePreference {
  try {
    return parsePreference(storage()?.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_PREFERENCE
  }
}

/** Saves the choice; false when storage refused it (the choice still applies until the page closes). */
export function writePreference(storage: () => Store | null | undefined, preference: ThemePreference): boolean {
  try {
    const s = storage()
    if (!s) return false
    s.setItem(THEME_STORAGE_KEY, preference)
    return true
  } catch {
    return false
  }
}
