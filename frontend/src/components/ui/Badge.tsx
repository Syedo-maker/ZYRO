type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'ai'

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-bg text-text-muted',
  ai: 'bg-ai-soft text-ai',
}

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}
