import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { bargainApi, type BargainTurn } from '../../lib/voiceBargainApi'

/**
 * Haggling on a product page (Part G, "bhao-taao"). Shown only when the merchant has set a price they
 * will come down to; otherwise the product is simply fixed-price and nothing appears.
 *
 * Every price here comes from the server. The assistant's words are shown beside the number, never
 * instead of it, so what the shopper reads and what they can actually pay are the same thing.
 */
export function BargainWidget({ storeId, productId, currency, onDeal }: { storeId: string; productId: string; currency: string; onDeal?: (code: string) => void }) {
  const [available, setAvailable] = useState(false)
  const [session, setSession] = useState<BargainTurn | null>(null)
  const [history, setHistory] = useState<{ who: 'you' | 'shop'; text: string }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bargainApi.offer(storeId, productId).then((r) => setAvailable(r.available)).catch(() => setAvailable(false))
  }, [storeId, productId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [history])

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const started = await bargainApi.start(storeId, productId)
      setSession(started)
      setHistory([{ who: 'shop', text: started.reply }])
    } catch (e) {
      setError(errorMessage(e, 'Could not start haggling just now.'))
    } finally {
      setBusy(false)
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!session || !message.trim()) return
    const mine = message.trim()
    setMessage('')
    setHistory((h) => [...h, { who: 'you', text: mine }])
    setBusy(true)
    setError(null)
    try {
      const turn = await bargainApi.turn(storeId, productId, session.sessionId, mine)
      setSession(turn)
      setHistory((h) => [...h, { who: 'shop', text: turn.reply }])
      if (turn.deal) onDeal?.(turn.deal.code)
    } catch (e) {
      setError(errorMessage(e, 'Could not send that.'))
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  if (!session) {
    return (
      <section aria-label="Bargaining" className="rounded-[10px] border border-border bg-white p-4">
        <h2 className="text-[13px] font-semibold">Think the price could be better?</h2>
        <p className="mt-1 text-xs text-text-secondary">Have a word with the shop, the way you would in the bazaar.</p>
        <Button variant="secondary" className="mt-3 h-10" disabled={busy} onClick={() => void open()}>
          {busy ? 'Opening...' : 'Make an offer'}
        </Button>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </section>
    )
  }

  const done = session.status !== 'open'

  return (
    <section aria-label="Bargaining" className="flex flex-col gap-3 rounded-[10px] border border-border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Making an offer</h2>
        <p className="text-xs text-text-secondary">
          Listed at <span className="line-through">{formatMoney(session.listPrice, currency)}</span>
        </p>
      </div>

      <div className="flex max-h-56 flex-col gap-2 overflow-y-auto" aria-live="polite">
        {history.map((m, i) => (
          <p key={i} className={`max-w-[85%] rounded-[10px] px-3 py-2 text-sm ${m.who === 'you' ? 'self-end bg-brand-soft text-text' : 'self-start bg-bg text-text'}`}>
            {m.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>

      <p className="rounded-[10px] bg-success-soft px-3 py-2 text-sm font-semibold text-success">
        The shop's price now: {formatMoney(session.offer, currency)}
      </p>

      {session.deal ? (
        <Alert tone="success">
          Agreed at {formatMoney(session.deal.price, currency)}. Use code <span className="font-bold">{session.deal.code}</span> at checkout. It is for this one order and expires shortly.
        </Alert>
      ) : done ? (
        <Alert tone="info">That is as far as the shop can go on this one.</Alert>
      ) : (
        <form onSubmit={send} className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              id="bargain-message"
              label={`Your message (${session.roundsLeft} ${session.roundsLeft === 1 ? 'try' : 'tries'} left)`}
              maxLength={500}
              autoComplete="off"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="800 kardo bhai"
            />
          </div>
          <Button type="submit" className="h-11" disabled={busy || !message.trim()}>
            {busy ? '...' : 'Send'}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </section>
  )
}
