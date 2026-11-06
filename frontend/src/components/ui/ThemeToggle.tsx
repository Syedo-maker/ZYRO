import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/themeContext'
import type { ThemePreference } from '../../lib/theme'

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Moon }[] = [
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'Match my device', Icon: Monitor },
]

/**
 * Dark, Light or System (B5): three toggle buttons, the chosen one pressed. Each has a name for screen
 * readers and a tooltip; the pressed one is a lime fill with black on it, in either theme. `touch` is
 * the register's 44-pixel size, for a finger at a counter.
 */
export function ThemeToggle({ className = '', touch = false }: { className?: string; touch?: boolean }) {
  const { preference, setPreference } = useTheme()
  return (
    <div role="group" aria-label="Theme" className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-surface p-0.5 ${className}`}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const pressed = preference === value
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            title={label}
            onClick={() => setPreference(value)}
            className={`grid ${touch ? 'h-11 w-11' : 'h-8 w-8'} place-items-center rounded-full transition-colors duration-150 ${pressed ? 'bg-brand text-on-brand' : 'text-text-secondary hover:bg-subtle hover:text-text'}`}
          >
            <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}
