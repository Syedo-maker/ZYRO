import { Sparkles } from 'lucide-react'

type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'ai'

// Status tones carry their meaning in the word they show as well as their colour. AI badges are lime
// with a sparkle, so AI-written content is never marked by colour alone.
const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  neutral: 'bg-subtle text-text-secondary border-border',
  ai: 'bg-ai-soft text-ai border-ai/30',
}

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold leading-5 ${TONE_CLASSES[tone]}`}>
      {tone === 'ai' && <Sparkles aria-hidden="true" className="h-3 w-3" strokeWidth={2} />}
      {children}
    </span>
  )
}
