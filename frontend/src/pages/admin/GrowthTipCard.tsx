import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { advisorApi, type AdvisorState } from '../../lib/advisorApi'
import { errorMessage } from '../../lib/ordersApi'

/**
 * This week's growth tip on the dashboard (Part C). The tip comes from automated weekly checks on
 * the store's own totals; the card says so, so the merchant knows why they are reading it. The
 * owner can switch tips off here (and back on); anyone who cannot read the store's figures simply
 * does not see the card. "Check now" runs the week's check straight away, for a store that has
 * not had its Monday check yet.
 */
export function GrowthTipCard({ storeId, isOwner }: { storeId: string; isOwner: boolean }) {
  const [state, setState] = useState<AdvisorState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState(await advisorApi.get(storeId))
  }, [storeId])

  useEffect(() => {
    load().catch(() => setState(null))
  }, [load])

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name)
    setNote(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setNote(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!state) return null

  if (!state.enabled) {
    return isOwner ? (
      <section aria-label="Growth tips" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white px-5 py-4">
        <p className="text-sm text-text-secondary">Weekly growth tips are switched off.</p>
        <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act('on', () => advisorApi.setEnabled(storeId, true))}>
          Switch tips on
        </Button>
      </section>
    ) : null
  }

  const tip = state.tip
  return (
    <section aria-label="Growth tips" className="rounded-2xl border border-brand/30 bg-brand-soft p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold">This week's tip</h2>
        <p className="text-xs text-text-secondary">From automated weekly checks on your store's totals</p>
      </div>
      {tip ? (
        <>
          <p className="text-sm leading-relaxed text-text">{tip.message}</p>
          {tip.topics.some((t) => t.kind === 'upgrade') && isOwner && (
            <Link to="/admin/billing" className="mt-2 inline-block text-sm font-semibold text-brand hover:text-brand-hover">
              See plans
            </Link>
          )}
        </>
      ) : (
        <p className="text-sm text-text-secondary">No tip this week yet: nothing new stood out in your figures. Checks run every Monday.</p>
      )}
      {note && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {note}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {tip ? (
          <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act('dismiss', () => advisorApi.dismiss(storeId, tip.id))}>
            {busy === 'dismiss' ? 'Hiding...' : 'Got it'}
          </Button>
        ) : (
          <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act('check', () => advisorApi.check(storeId))}>
            {busy === 'check' ? 'Checking...' : 'Check now'}
          </Button>
        )}
        {isOwner && (
          <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void act('off', () => advisorApi.setEnabled(storeId, false))}>
            Turn off tips
          </Button>
        )}
      </div>
    </section>
  )
}
