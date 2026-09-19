import { createPortal } from 'react-dom'
import { formatDateTime, formatMoney } from '../../lib/format'
import type { Sale } from '../../types/pos'

/**
 * A second copy of the receipt placed directly in <body>, hidden on screen. When printing,
 * the print stylesheet (index.css) hides the rest of the page and shows only this copy, so
 * the paper gets just the receipt whatever dialog is open. Render it while a sale is shown.
 */
export function ReceiptPrintCopy({ sale }: { sale: Sale }) {
  return createPortal(
    <div className="print-only" aria-hidden="true">
      <Receipt sale={sale} />
    </div>,
    document.body
  )
}

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', other: 'Other', stripe: 'Online card' }

/**
 * The receipt, laid out for an 80mm roll.
 */
export function Receipt({ sale }: { sale: Sale }) {
  const money = (n: number) => formatMoney(n, sale.currency)
  const returned = sale.returns.reduce((s, r) => s + r.amount, 0)

  return (
    <article aria-label={`Receipt for sale ${sale.orderNumber}`} className="mx-auto w-full max-w-[340px] bg-white text-text font-mono text-[13px] leading-relaxed">
      <header className="text-center pb-3 border-b border-dashed border-text/40">
        <div className="font-display text-lg font-bold">{sale.store.name}</div>
        <div>Sale #{sale.orderNumber}</div>
        <div>{formatDateTime(sale.createdAt)}</div>
        {sale.cashier && <div>Served by {sale.cashier.name}</div>}
        {sale.customer && <div>Customer: {sale.customer.name ?? sale.customer.email}</div>}
      </header>

      <ul className="py-3 border-b border-dashed border-text/40 flex flex-col gap-1.5">
        {sale.items.map((i) => (
          <li key={i.id}>
            <div className="flex justify-between gap-3">
              <span>{i.productTitleSnapshot}</span>
              <span className="tabular-nums">{money(i.lineTotal)}</span>
            </div>
            <div className="text-text-secondary">
              {i.quantity} x {money(i.unitPrice)}
              {i.returnedQuantity > 0 ? `  (${i.returnedQuantity} returned)` : ''}
            </div>
          </li>
        ))}
      </ul>

      <dl className="py-3 border-b border-dashed border-text/40 grid grid-cols-[1fr_auto] gap-y-0.5">
        <dt>Subtotal</dt>
        <dd className="text-right tabular-nums">{money(sale.subtotal)}</dd>
        {sale.discountAmount > 0 && (
          <>
            <dt>Discount{sale.discountReason ? ` (${sale.discountReason})` : ''}</dt>
            <dd className="text-right tabular-nums">-{money(sale.discountAmount)}</dd>
          </>
        )}
        <dt>Tax</dt>
        <dd className="text-right tabular-nums">{money(sale.taxAmount)}</dd>
        <dt className="font-bold text-base">Total</dt>
        <dd className="text-right font-bold text-base tabular-nums">{money(sale.total)}</dd>
      </dl>

      <dl className="py-3 grid grid-cols-[1fr_auto] gap-y-0.5">
        {sale.payments.map((p) => (
          <div key={p.id} className="contents">
            <dt>{METHOD_LABEL[p.method] ?? p.method}</dt>
            <dd className="text-right tabular-nums">{money(p.tenderedAmount ?? p.amount)}</dd>
          </div>
        ))}
        {sale.changeDue > 0 && (
          <>
            <dt className="font-bold">Change</dt>
            <dd className="text-right font-bold tabular-nums">{money(sale.changeDue)}</dd>
          </>
        )}
      </dl>

      {sale.returns.length > 0 && (
        <section className="py-3 border-t border-dashed border-text/40">
          <div className="font-bold">Returned</div>
          <ul>
            {sale.returns.map((r) => (
              <li key={r.id}>
                <div className="flex justify-between gap-3">
                  <span>
                    {r.items.map((i) => `${i.quantity} x ${i.productTitleSnapshot}`).join(', ')} ({METHOD_LABEL[r.method] ?? r.method})
                  </span>
                  <span className="tabular-nums">-{money(r.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex justify-between font-bold pt-1">
            <span>Refunded in total</span>
            <span className="tabular-nums">-{money(returned)}</span>
          </div>
        </section>
      )}

      <footer className="text-center pt-3 border-t border-dashed border-text/40">Thank you for shopping with us.</footer>
    </article>
  )
}
