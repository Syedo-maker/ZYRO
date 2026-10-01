import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { paymentsApi, type LocalOrderInput, type PaymentOptions, type PlacedOrder } from '../../lib/paymentsApi'

export type PayMethod = 'card' | 'cod' | 'bank_transfer'

export interface DeliveryDetails {
  name: string
  phone: string
  email: string
  line1: string
  line2: string
  city: string
  postalCode: string
  country: string
}

export const emptyDelivery: DeliveryDetails = { name: '', phone: '', email: '', line1: '', line2: '', city: '', postalCode: '', country: 'PK' }

export const toOrderInput = (method: 'cod' | 'bank_transfer', d: DeliveryDetails, zoneId?: string, code?: string): LocalOrderInput => ({
  method,
  name: d.name.trim(),
  phone: d.phone.trim(),
  email: d.email.trim() || null,
  address: {
    line1: d.line1.trim(),
    line2: d.line2.trim() || null,
    city: d.city.trim(),
    postalCode: d.postalCode.trim() || null,
    country: d.country.trim().toUpperCase(),
  },
  shippingZoneId: zoneId,
  discountCode: code,
})

const complete = (d: DeliveryDetails) => Boolean(d.name.trim() && d.phone.trim().length >= 5 && d.line1.trim() && d.city.trim() && d.country.trim().length === 2)

/**
 * Where a shopper gives the delivery details and chooses cash on delivery or a bank transfer
 * (Part E). Card payments still go to Stripe, which collects the address itself; these methods do
 * not, so the details are asked for here, and the phone number is required because a courier
 * carrying cash needs to ring ahead.
 *
 * Which methods appear comes from the server. When cash on delivery is not offered for this
 * particular order the shopper is told only that, never a score or a reason: explaining it would
 * teach anyone how to word an order around it.
 */
export function LocalPaymentSection({
  storeId,
  method,
  onMethodChange,
  delivery,
  onDeliveryChange,
  zoneId,
  code,
  onPlaced,
}: {
  storeId: string
  method: PayMethod
  onMethodChange: (m: PayMethod) => void
  delivery: DeliveryDetails
  onDeliveryChange: (d: DeliveryDetails) => void
  zoneId?: string
  code?: string
  onPlaced: (order: PlacedOrder) => void
}) {
  const [options, setOptions] = useState<PaymentOptions | null>(null)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // Asked with whatever has been typed so far, so a shopper sees the choices update as they fill in.
    const probe = toOrderInput('cod', complete(delivery) ? delivery : { ...emptyDelivery, name: 'x', phone: '0000000000', line1: 'x', city: 'x' }, zoneId, code)
    setOptions(await paymentsApi.options(storeId, probe))
  }, [storeId, delivery, zoneId, code])

  useEffect(() => {
    refresh().catch(() => setOptions(null))
  }, [refresh])

  const set = <K extends keyof DeliveryDetails>(key: K, value: DeliveryDetails[K]) => onDeliveryChange({ ...delivery, [key]: value })

  async function place() {
    if (method === 'card') return
    setPlacing(true)
    setError(null)
    try {
      onPlaced(await paymentsApi.placeOrder(storeId, toOrderInput(method, delivery, zoneId, code)))
    } catch (e) {
      setError(errorMessage(e, 'Could not place your order.'))
      setPlacing(false)
    }
  }

  const codAvailable = options?.cod.available ?? false
  const bankAvailable = options?.bankTransfer.available ?? false
  if (!options || (!codAvailable && !bankAvailable && method === 'card')) return null

  const choice = (value: PayMethod, title: string, note: string, disabled = false) => (
    <label
      key={value}
      className={`flex cursor-pointer items-start gap-3 rounded-[10px] bg-white px-4 py-3.5 ${method === value ? 'border-2 border-brand' : 'border border-border'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input type="radio" name="pay-method" value={value} checked={method === value} disabled={disabled} onChange={() => onMethodChange(value)} className="mt-0.5 h-4 w-4 accent-brand" />
      <span>
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-xs text-text-muted">{note}</span>
      </span>
    </label>
  )

  return (
    <section aria-labelledby="pay-method-heading" className="flex flex-col gap-4">
      <h2 id="pay-method-heading" className="text-xs font-bold text-brand">
        HOW YOU WOULD LIKE TO PAY
      </h2>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="sr-only">Payment method</legend>
        {choice('card', 'Card', 'Pay now on a secure page. Your card details never reach this shop.')}
        {codAvailable
          ? choice('cod', 'Cash on delivery', options.cod.advanceAmount ? `Pay ${formatMoney(options.cod.advanceAmount, options.currency)} now and the rest to the courier.` : 'Pay the courier in cash when your parcel arrives.')
          : options.cod.note && choice('cod', 'Cash on delivery', options.cod.note, true)}
        {bankAvailable && choice('bank_transfer', 'Bank or wallet transfer', 'Send the money yourself, then upload the receipt.')}
      </fieldset>

      {method !== 'card' && (
        <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-white p-4">
          <h3 className="text-[13px] font-semibold">Where should we deliver?</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="d-name" label="Full name" required maxLength={120} autoComplete="name" value={delivery.name} onChange={(e) => set('name', e.target.value)} />
            <Input id="d-phone" label="Phone number" required maxLength={32} autoComplete="tel" placeholder="03001234567" value={delivery.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input id="d-email" label="Email (optional)" type="email" maxLength={254} autoComplete="email" value={delivery.email} onChange={(e) => set('email', e.target.value)} />
            <Input id="d-line1" label="Address" required maxLength={200} autoComplete="address-line1" value={delivery.line1} onChange={(e) => set('line1', e.target.value)} />
            <Input id="d-line2" label="Flat, floor (optional)" maxLength={200} autoComplete="address-line2" value={delivery.line2} onChange={(e) => set('line2', e.target.value)} />
            <Input id="d-city" label="City" required maxLength={100} autoComplete="address-level2" value={delivery.city} onChange={(e) => set('city', e.target.value)} />
            <Input id="d-postal" label="Postal code (optional)" maxLength={32} autoComplete="postal-code" value={delivery.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
            <Input id="d-country" label="Country code" required maxLength={2} minLength={2} autoComplete="country" value={delivery.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
          </div>
          <p className="text-xs text-text-muted">We ask for a phone number so the courier can call before delivering.</p>

          {method === 'bank_transfer' && options.bankTransfer.available && (
            <div className="rounded-[10px] bg-bg p-3 text-sm">
              <p className="font-semibold">Send the money to:</p>
              <p className="text-text-secondary">
                {options.bankTransfer.accountName} · {options.bankTransfer.accountNumber} · {options.bankTransfer.bankName}
              </p>
              {options.bankTransfer.instructions && <p className="mt-1 text-xs text-text-secondary">{options.bankTransfer.instructions}</p>}
              <p className="mt-1 text-xs text-text-muted">Place the order first, then upload your receipt on the next page.</p>
            </div>
          )}

          {error && <Alert>{error}</Alert>}

          <Button onClick={() => void place()} disabled={placing || !complete(delivery)} className="h-[50px]">
            {placing ? 'Placing your order...' : `Place order for ${formatMoney(options.total, options.currency)}`}
          </Button>
          {!complete(delivery) && <p className="text-xs text-text-muted">Fill in your name, phone, address, city and country code to place the order.</p>}
        </div>
      )}
    </section>
  )
}
