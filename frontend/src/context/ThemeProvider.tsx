import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readPreference, resolveTheme, THEME_COLOR, writePreference, type ThemePreference } from '../lib/theme'
import { ThemeContext } from './themeContext'

const storage = () => window.localStorage
const LIGHT_QUERY = '(prefers-color-scheme: light)'

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia(LIGHT_QUERY).matches
  } catch {
    return false
  }
}

/**
 * Keeps <html data-theme> in step with the visitor's choice (B5). public/theme-init.js has already set
 * it before the first paint; this takes over from there, saves a new choice, and follows the device
 * when the choice is System and the device switches between light and dark.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readPreference(storage))
  const [systemLight, setSystemLight] = useState(systemPrefersLight)

  useEffect(() => {
    let media: MediaQueryList
    try {
      media = window.matchMedia(LIGHT_QUERY)
    } catch {
      return
    }
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(preference, systemLight)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  }, [theme])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writePreference(storage, next)
  }, [])

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
