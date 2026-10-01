import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { errorMessage } from '../../lib/ordersApi'
import { paymentsApi } from '../../lib/paymentsApi'

/**
 * After a cash-on-delivery or bank-transfer order is placed (Part E). Cash on delivery just needs
 * confirming. A transfer needs the receipt, so this is where the shopper uploads it; they are told
 * it is waiting to be checked, and later whether it was accepted, but never the checks themselves.
 */
export function OrderPlacedPage() {
  const store = useStore()
  const { reload } = useCart()
  const [params] = useSearchParams()
  const orderId = params.get('order') ?? ''
  const method = params.get('method') ?? 'cod'

  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ status: string; reason?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshed = useRef(false)

  useEffect(() => {
    // The order already took the items, so the cart badge should empty.
    if (!refreshed.current) {
      refreshed.current = true
      void reload()
    }
    if (method === 'bank_transfer' && orderId) {
      paymentsApi.proofStatus(store.id, orderId).then(setStatus).catch(() => setStatus(null))
    }
  }, [store.id, orderId, method, reload])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const url = await paymentsApi.uploadProofImage(store.id, orderId, file)
      await paymentsApi.submitProof(store.id, orderId, { imageUrl: url, declaredAmount: Number(amount), declaredReference: reference.trim() || undefined })
      setStatus(await paymentsApi.proofStatus(store.id, orderId))
    } catch (err) {
      setError(errorMessage(err, 'Could not send your receipt.'))
    } finally {
      setBusy(false)
    }
  }

  const keepShopping = (
    <Link to={`/store/${store.id}/products`} className="text-sm font-semibold text-brand hover:text-brand-hover">
      Keep shopping
    </Link>
  )

  if (!orderId) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-2xl font-bold">Order placed</h1>
        {keepShopping}
      </div>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <h1 className="font-display text-2xl font-bold">Thank you, your order is placed</h1>

      {method === 'cod' ? (
        <Alert tone="success">Pay the courier in cash when your parcel arrives. The shop will be in touch to arrange delivery.</Alert>
      ) : status && status.status !== 'none' ? (
        <>
          {status.status === 'pending' && <Alert tone="info">Your receipt has been sent to the shop. They will check it and confirm your order.</Alert>}
          {status.status === 'accepted' && <Alert tone="success">The shop has confirmed your payment. Your order is on its way.</Alert>}
          {status.status === 'rejected' && (
            <Alert>
              The shop could not accept that receipt{status.reason ? `: ${status.reason}` : '.'} Please contact them, or place the order again.
            </Alert>
          )}
        </>
      ) : (
        <form onSubmit={send} aria-label="Send your receipt" className="flex flex-col gap-3 rounded-[10px] border border-border bg-white p-4">
          <h2 className="text-[13px] font-semibold">Send your receipt</h2>
          <p className="text-xs text-text-secondary">
            Transfer the money using the details the shop gave you, then upload a screenshot of the receipt so they can confirm your order.
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="proof-file" className="text-xs font-semibold text-text-secondary">
              Screenshot
            </label>
            <input id="proof-file" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <Input id="proof-amount" label="Amount you sent" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input id="proof-reference" label="Transfer reference (helps the shop find it)" maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy || !file || !amount}>
            {busy ? 'Sending...' : 'Send receipt'}
          </Button>
        </form>
      )}

      {keepShopping}
    </div>
  )
}
