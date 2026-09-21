import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { checkoutApi, storefrontApi } from '../../lib/storefrontApi'
import type { Quote, ShippingZone } from '../../types/commerce'

function TotalsRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-bold' : 'text-[13px] text-text-secondary'}`}>
      <span>{label}</span>
      <span className={strong ? '' : 'font-semibold text-text'}>{value}</span>
    </div>
  )
}

export function CheckoutPage() {
  const store = useStore()
  const { cart, isLoading: cartLoading } = useCart()
  const [zones, setZones] = useState<ShippingZone[] | null>(null)
  const [zoneId, setZoneId] = useState<string | undefined>()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  // A discount code the shopper has typed and the server accepted; it stays until they remove it.
  const [codeInput, setCodeInput] = useState('')
  const [code, setCode] = useState<string | undefined>()
  const [codeError, setCodeError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    storefrontApi
      .listShippingZones(store.id)
      .then((z) => {
        if (cancelled) return
        setZones(z)
        setZoneId(z[0]?.id)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [store.id])

  // The total comes from the server so tax and shipping are never calculated in the browser.
  useEffect(() => {
    if (zones === null || !cart || cart.items.length === 0) return
    let cancelled = false
    setQuote(null)
    checkoutApi
      .quote(store.id, zoneId, code)
      .then((q) => !cancelled && (setQuote(q), setError(null)))
      .catch((e) => {
        if (cancelled) return
        // A code that stopped working (switched off, used up, cart changed) is dropped with a reason.
        if (code) {
          setCode(undefined)
          setCodeError(errorMessage(e))
        } else setError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [store.id, zones, zoneId, cart, code])

  async function applyCode() {
    const typed = codeInput.trim()
    if (!typed) return
    setApplying(true)
    setCodeError(null)
    try {
      // Checked first on its own, so a wrong code shows a message here without disturbing the total.
      await checkoutApi.quote(store.id, zoneId, typed)
      setCode(typed)
      setCodeInput('')
    } catch (e) {
      setCodeError(errorMessage(e))
    } finally {
      setApplying(false)
    }
  }

  async function handlePay() {
    setPaying(true)
    setError(null)
    try {
      const { checkoutUrl } = await checkoutApi.createSession(store.id, zoneId, code)
      window.location.assign(checkoutUrl)
    } catch (e) {
      setError(errorMessage(e))
      setPaying(false)
    }
  }

  if (cartLoading || zones === null) return <Spinner label="Loading checkout" />
  if (!cart || cart.items.length === 0) return <Navigate to={`/store/${store.id}/cart`} replace />

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold">Checkout</h1>
      {error && (
        <Alert>
          {error} <Link to={`/store/${store.id}/cart`} className="underline">Back to cart</Link>
        </Alert>
      )}

      <div className="flex flex-col items-start gap-8 lg:flex-row lg:gap-12">
        <div className="flex w-full flex-1 flex-col gap-8">
          <section aria-labelledby="shipping-heading">
            <h2 id="shipping-heading" className="mb-3 text-xs font-bold text-brand">
              1. SHIPPING METHOD
            </h2>
            {zones.length === 0 ? (
              <p className="rounded-[10px] border border-border bg-white px-4 py-3.5 text-sm text-text-secondary">
                This store has no shipping charge configured, so shipping is free.
              </p>
            ) : (
              <fieldset className="flex flex-col gap-2.5">
                <legend className="sr-only">Shipping method</legend>
                {zones.map((z) => (
                  <label
                    key={z.id}
                    className={`flex cursor-pointer items-center justify-between rounded-[10px] bg-white px-4 py-3.5 ${
                      zoneId === z.id ? 'border-2 border-brand' : 'border border-border'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping-zone"
                        value={z.id}
                        checked={zoneId === z.id}
                        onChange={() => setZoneId(z.id)}
                        className="h-4 w-4 accent-brand"
                      />
                      <span>
                        <span className="block text-[13px] font-semibold">{z.name}</span>
                        <span className="block text-xs text-text-muted">{z.region}</span>
                      </span>
                    </span>
                    <span className="text-[13px] font-bold">{formatMoney(z.rateAmount, store.currency)}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>

          <section aria-labelledby="payment-heading">
            <h2 id="payment-heading" className="mb-3 text-xs font-bold text-brand">
              2. PAYMENT
            </h2>
            <p className="rounded-[10px] border border-border bg-white px-4 py-3.5 text-[13px] leading-relaxed text-text-secondary">
              You will enter your email, shipping address and card details on Stripe&apos;s secure payment page. ZYRO never sees or
              stores your card number.
            </p>
          </section>
        </div>

        <aside className="flex w-full flex-col gap-4 rounded-[14px] border border-border bg-white p-6 lg:w-[340px]" aria-label="Order summary">
          <h2 className="text-[15px] font-bold">Order summary</h2>
          <ul className="flex flex-col gap-3">
            {cart.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-bg">
                  {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <span className="flex-1 text-[13px]">
                  {item.title} <span className="text-text-muted">× {item.quantity}</span>
                </span>
                <span className="text-[13px] font-semibold">{formatMoney(item.lineTotal, cart.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="h-px bg-border" />

          <div className="flex flex-col gap-2">
            {code ? (
              <p className="flex items-center justify-between rounded-[10px] bg-success-soft px-3 py-2 text-[13px] font-semibold text-success">
                <span>Code {quote?.discount?.code ?? code.toUpperCase()} applied</span>
                <button
                  onClick={() => {
                    setCode(undefined)
                    setCodeError(null)
                  }}
                  className="underline"
                  aria-label="Remove discount code"
                >
                  Remove
                </button>
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void applyCode()
                }}
                className="flex items-end gap-2"
                aria-label="Have a code?"
              >
                <div className="flex-1">
                  <Input id="discount-code" label="Discount code" maxLength={30} autoComplete="off" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} error={codeError ?? undefined} />
                </div>
                <Button type="submit" variant="secondary" disabled={applying || !codeInput.trim()} className="h-11">
                  {applying ? '...' : 'Apply'}
                </Button>
              </form>
            )}
            {code && codeError && <p role="alert" className="text-xs text-danger">{codeError}</p>}
          </div>

          {quote ? (
            <div className="flex flex-col gap-2.5" aria-live="polite">
              <TotalsRow label="Subtotal" value={formatMoney(quote.subtotal, quote.currency)} />
              {quote.discountAmount > 0 && <TotalsRow label={`Discount${quote.discount ? ` (${quote.discount.code})` : ''}`} value={`-${formatMoney(quote.discountAmount, quote.currency)}`} />}
              <TotalsRow label="Shipping" value={formatMoney(quote.shippingAmount, quote.currency)} />
              <TotalsRow label="Tax" value={formatMoney(quote.taxAmount, quote.currency)} />
              <div className="my-1 h-px bg-border" />
              <TotalsRow label="Total" value={formatMoney(quote.total, quote.currency)} strong />
            </div>
          ) : (
            !error && <Spinner label="Calculating total" />
          )}

          <Button onClick={() => void handlePay()} disabled={!quote || paying} className="mt-2 h-[50px]">
            {paying ? 'Redirecting to Stripe…' : quote ? `Pay ${formatMoney(quote.total, quote.currency)}` : 'Pay'}
          </Button>
        </aside>
      </div>
    </div>
  )
}
