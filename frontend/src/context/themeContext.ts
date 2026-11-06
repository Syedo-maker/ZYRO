import { createContext, useContext } from 'react'
import type { Theme, ThemePreference } from '../lib/theme'

export interface ThemeState {
  /** What the visitor chose: dark, light, or whatever their device uses. */
  preference: ThemePreference
  /** The theme on screen now. */
  theme: Theme
  setPreference: (preference: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeState | null>(null)

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext)
  if (!state) throw new Error('useTheme needs a ThemeProvider above it')
  return state
}
