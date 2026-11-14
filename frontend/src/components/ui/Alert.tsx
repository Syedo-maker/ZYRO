import { CircleAlert, CircleCheck, Info } from 'lucide-react'

type Tone = 'error' | 'info' | 'success'

// Info is neutral (black and white with a lime icon), so the lime never looks like a status.
const TONE_CLASSES: Record<Tone, string> = {
  error: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-surface text-text border-border',
  success: 'bg-success-soft text-success border-success/30',
}

const ICONS = { error: CircleAlert, info: Info, success: CircleCheck }
const ICON_COLOUR: Record<Tone, string> = { error: 'text-danger', info: 'text-brand', success: 'text-success' }

/** Errors are announced to screen readers immediately; info and success politely. */
export function Alert({ tone = 'error', children }: { tone?: Tone; children: React.ReactNode }) {
  const Icon = ICONS[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-control border px-4 py-3 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOUR[tone]}`} strokeWidth={2} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
