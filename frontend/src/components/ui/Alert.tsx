type Tone = 'error' | 'info' | 'success'

const TONE_CLASSES: Record<Tone, string> = {
  error: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-brand-soft text-brand border-brand/30',
  success: 'bg-success-soft text-success border-success/30',
}

/** Errors are announced to screen readers immediately; info and success politely. */
export function Alert({ tone = 'error', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[10px] border px-4 py-3 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </div>
  )
}
