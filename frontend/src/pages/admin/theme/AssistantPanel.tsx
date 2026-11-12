import { Palette, Send, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../../components/ui/Button'
import type { AiUsageQuota } from '../../../types/shop'
import type { AssistantAnswer, DesignOption, QuickAction } from '../../../lib/themeApi'
import { ThemeSwatch } from './ThemeSwatch'

interface Turn {
  id: number
  from: 'owner' | 'assistant' | 'notice'
  text: string
  question?: string | null
  options?: DesignOption[]
  applied?: number
}

const QUICK: { id: QuickAction; label: string; icon: typeof Sparkles }[] = [
  { id: 'bolder', label: 'Try a bolder look', icon: Sparkles },
  { id: 'simpler', label: 'Make it simpler', icon: Wand2 },
  { id: 'logo', label: 'Match my logo colors', icon: Palette },
]

/**
 * The design assistant's side of the Studio (Store Themes, Part 2). The owner writes in English,
 * Roman Urdu or Urdu, or presses a quick action; the best look is applied at once and the others are
 * offered as cards to try. Replies are announced to screen readers through a polite live region.
 * When the AI is unavailable the panel says so and the manual controls stay usable.
 */
export function AssistantPanel({
  ask,
  onTry,
  quota,
  logoColours,
  hasLogo,
}: {
  ask: (body: { message?: string; action?: QuickAction; logoColors?: string[] }) => Promise<{ answer: AssistantAnswer | null; error: string | null }>
  onTry: (option: DesignOption) => void
  quota: AiUsageQuota | null
  logoColours: string[]
  hasLogo: boolean
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState<Record<number, number>>({})
  const counter = useRef(0)
  const log = useRef<HTMLOListElement>(null)

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' })
  }, [turns, busy])

  const push = (turn: Omit<Turn, 'id'>) => setTurns((t) => [...t, { ...turn, id: ++counter.current }])

  async function send(body: { message?: string; action?: QuickAction }, label: string) {
    if (busy) return
    if (body.action === 'logo' && logoColours.length === 0) {
      push({ from: 'notice', text: hasLogo ? 'Upload your logo again in Customize, so its colours can be read.' : 'Upload a logo in Customize first, then I can match its colours.' })
      return
    }
    push({ from: 'owner', text: label })
    setBusy(true)
    const { answer, error } = await ask(body.action === 'logo' ? { ...body, logoColors: logoColours } : body)
    setBusy(false)
    if (answer) push({ from: 'assistant', text: answer.reply, question: answer.question, options: answer.options, applied: answer.applied })
    else push({ from: 'notice', text: error ?? 'The AI assistant is temporarily unavailable. You can keep designing with the controls.' })
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = message.trim()
    if (!text) return
    setMessage('')
    void send({ message: text }, text)
  }

  const left = quota ? Math.max(0, quota.generationsLimit - quota.generationsUsed) + quota.topUpGenerations : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ol ref={log} aria-live="polite" aria-relevant="additions" aria-label="Conversation with the design assistant" className="flex min-h-[120px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <li className="rounded-xl bg-subtle p-3 text-sm text-text-secondary">
            Tell me the feel you want, for example &ldquo;warm and handmade&rdquo; or &ldquo;mujhe dark aur premium look chahiye&rdquo;. I apply my best idea right away and show you two more to try.
          </li>
        )}
        {turns.map((t) => (
          <li key={t.id} className={t.from === 'owner' ? 'self-end' : 'self-stretch'}>
            {t.from === 'owner' && <p dir="auto" className="max-w-[85%] rounded-xl bg-brand-soft px-3 py-2 text-sm text-text">{t.text}</p>}
            {t.from === 'notice' && <p role="status" className="rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-text">{t.text}</p>}
            {t.from === 'assistant' && (
              <div className="flex flex-col gap-2">
                <p dir="auto" className="text-sm text-text">{t.text}</p>
                {t.question && <p dir="auto" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text">{t.question}</p>}
                <ul aria-label="Recommended looks" className="flex flex-col gap-2">
                  {t.options?.map((o, i) => {
                    const current = (tried[t.id] ?? t.applied) === i
                    return (
                      <li key={i} className={`flex flex-col gap-2 rounded-xl border p-3 ${current ? 'border-brand-ink bg-brand-soft' : 'border-border bg-surface'}`}>
                        <ThemeSwatch tokens={o.tokens} />
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p dir="auto" className="text-sm font-bold text-text">{o.name}</p>
                            <p dir="auto" className="text-xs text-text-secondary">{o.reason}</p>
                          </div>
                          {current ? (
                            <span className="shrink-0 text-xs font-semibold text-brand-ink">Applied</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setTried((x) => ({ ...x, [t.id]: i }))
                                onTry(o)
                              }}
                            >
                              Try this
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </li>
        ))}
        {busy && (
          <li role="status" className="flex items-center gap-2 text-sm text-text-secondary">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-brand-ink border-t-transparent" />
            Designing your theme...
          </li>
        )}
      </ol>

      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q.id}
            type="button"
            disabled={busy}
            onClick={() => void send({ action: q.id }, q.label)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold text-text hover:border-brand-ink hover:text-brand-ink disabled:opacity-50"
          >
            <q.icon aria-hidden="true" className="h-3.5 w-3.5" />
            {q.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2">
        <label htmlFor="theme-assistant-input" className="sr-only">
          Describe the look you want
        </label>
        <textarea
          id="theme-assistant-input"
          dir="auto"
          rows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Describe the look you want (English, Roman Urdu or اردو)"
          className="min-h-11 flex-1 resize-none rounded-control border border-border-input bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button type="submit" aria-label="Send" loading={busy} disabled={!message.trim()} className="h-11 w-11 px-0">
          {!busy && <Send aria-hidden="true" className="h-4 w-4" />}
        </Button>
      </form>
      {left !== null && (
        <p className="text-xs text-text-muted">
          Each request uses one AI generation. {left} left this month ({quota?.plan} plan). A request that fails uses none.
        </p>
      )}
    </div>
  )
}
