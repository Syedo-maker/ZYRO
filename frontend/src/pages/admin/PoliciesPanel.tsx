import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { POLICY_KINDS, POLICY_TITLES, policiesApi, type PolicyKind } from '../../lib/policiesApi'
import { POLICY_TEMPLATES, isStillTemplate } from '../../lib/policyTemplates'

/**
 * The shop's own policy pages (returns and refunds, shipping, privacy, terms), shown to shoppers at
 * /store/:id/policies. The owner writes each one, or starts from a template written for a small shop
 * in Pakistan. The templates are not legal advice and say so in their first line; this panel keeps
 * warning while that line or a [placeholder] is still in the text.
 */
export function PoliciesPanel({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [saved, setSaved] = useState<Record<PolicyKind, string> | null>(null)
  const [kind, setKind] = useState<PolicyKind>('refund')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    policiesApi
      .list(storeId)
      .then(({ policies }) => {
        const map = { refund: '', shipping: '', privacy: '', terms: '' } as Record<PolicyKind, string>
        for (const p of policies) map[p.kind] = p.body
        setSaved(map)
        setText(map.refund)
      })
      .catch((e) => setError(errorMessage(e, 'Could not load your shop policies.')))
  }, [storeId])

  function choose(next: PolicyKind) {
    if (!saved) return
    setKind(next)
    setText(saved[next])
    setNotice(null)
    setError(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!saved) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await policiesApi.set(storeId, kind, text)
      setSaved({ ...saved, [kind]: result.body ?? '' })
      setText(result.body ?? '')
      setNotice(result.body ? `${POLICY_TITLES[kind]} is saved and shown on your shop.` : `${POLICY_TITLES[kind]} is removed from your shop.`)
    } catch (err) {
      setError(errorMessage(err, 'Could not save this policy.'))
    } finally {
      setSaving(false)
    }
  }

  if (!saved) return error ? <Alert>{error}</Alert> : <Spinner label="Loading your shop policies" />

  const changed = text.trim() !== saved[kind].trim()
  return (
    <section aria-label="Shop policies" className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-display text-base font-bold">Shop policies</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Shoppers find these from your shop's footer, on{' '}
        <Link to={`/store/${storeId}/policies`} className="text-text underline underline-offset-2">your policies page</Link>. A policy you leave
        empty is not shown.
      </p>

      <div role="tablist" aria-label="Policy" className="mt-4 flex flex-wrap gap-2">
        {POLICY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            onClick={() => choose(k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${k === kind ? 'border-brand-ink bg-brand-ink/10 text-text' : 'border-border text-text-secondary hover:text-text'}`}
          >
            {POLICY_TITLES[k]}
            {saved[k] ? '' : ' (not written)'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {notice && (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}

      <form onSubmit={save} className="mt-4 flex flex-col gap-3">
        <label htmlFor="policy-text" className="text-sm font-semibold">
          {POLICY_TITLES[kind]}
        </label>
        <textarea
          id="policy-text"
          rows={12}
          maxLength={20000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="rounded-control border border-border-input bg-surface px-3.5 py-2.5 font-mono text-xs leading-relaxed outline-none focus:border-brand-ink focus:ring-2 focus:ring-brand-ink/30"
        />
        {text.trim() && isStillTemplate(text) && (
          <Alert tone="info">
            This still has the template note or a [placeholder] in it, and shoppers will see exactly what is here. Have a lawyer review it, fill in
            your shop's details, and delete the first line.
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving || !changed}>
            {saving ? 'Saving...' : text.trim() ? 'Save policy' : 'Remove policy'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              if (text.trim() && !window.confirm('Replace what you wrote with the template?')) return
              setText(POLICY_TEMPLATES[kind](storeName))
              setNotice(null)
            }}
          >
            Start from a template
          </Button>
        </div>
      </form>
    </section>
  )
}
