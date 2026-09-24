import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { ApiError } from '../../lib/apiClient'
import { assistantApi } from '../../lib/assistantApi'
import { getConversationId } from '../../lib/assistantId'
import type { Product } from '../../types/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  suggestedProducts?: Product[]
}

const GREETING: ChatMessage = { role: 'assistant', content: 'Hi! Ask me anything about our products - I can help you find what you need.' }

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) return "Sorry, I'm not available right now. Please browse the catalog, or contact the store directly."
    if (err.status === 429) return "You're sending messages a little fast - please wait a moment and try again."
  }
  return errorMessage(err, "Sorry, something went wrong. Please try again.")
}

/**
 * Module 3: AI Shopping Assistant (Implementation_Plan.md Phase 5), a floating widget on every
 * storefront page. The conversationId persists across a visit (lib/assistantId.ts), so the
 * assistant's own short-term memory (Redis, on the backend) survives a reload even though this
 * widget's own visible message list is deliberately kept in component state only, not
 * re-fetched from a transcript endpoint - a simpler prototype scope, noted in the module's docs.
 */
export function AssistantWidget({ storeId, currency }: { storeId: string; currency: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  function scrollToBottom() {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const message = input.trim()
    if (!message || sending) return
    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: message }])
    setSending(true)
    scrollToBottom()
    try {
      const result = await assistantApi.chat(storeId, getConversationId(), message)
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply, suggestedProducts: result.suggestedProducts }])
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSending(false)
      scrollToBottom()
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div role="dialog" aria-label="Shopping assistant" className="flex h-[480px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold">Ask us anything</h2>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="text-text-muted hover:text-text">
              ✕
            </button>
          </div>

          <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <p className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'bg-brand text-white' : 'bg-bg text-text'}`}>{m.content}</p>
                {m.suggestedProducts && m.suggestedProducts.length > 0 && (
                  <div className="flex w-full gap-2 overflow-x-auto pb-1">
                    {m.suggestedProducts.map((p) => (
                      <Link
                        key={p.id}
                        to={`/store/${storeId}/products/${p.id}`}
                        className="flex w-32 shrink-0 flex-col gap-1 rounded-[10px] border border-border p-2 hover:border-brand"
                      >
                        <div className="aspect-square w-full overflow-hidden rounded-lg bg-bg">
                          {p.images[0] && <img src={p.images[0]} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <span className="line-clamp-2 text-xs font-semibold">{p.title}</span>
                        <span className="text-xs font-bold">{p.stock > 0 ? formatMoney(p.price, currency) : 'Sold out'}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sending && <Spinner label="Thinking…" />}
            {error && (
              <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={(e) => void handleSend(e)} className="flex gap-2 border-t border-border p-3">
            <label htmlFor="assistant-message" className="sr-only">
              Your message
            </label>
            <input
              id="assistant-message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about a product..."
              maxLength={1000}
              disabled={sending}
              className="h-10 flex-1 rounded-[10px] border border-border px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
            />
            <Button type="submit" className="h-10 px-4" disabled={sending || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close shopping assistant' : 'Open shopping assistant'}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:bg-brand-hover"
      >
        {open ? (
          <span aria-hidden="true" className="text-xl">✕</span>
        ) : (
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        )}
      </button>
    </div>
  )
}
