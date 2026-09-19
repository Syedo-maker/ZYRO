import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { formatMoney } from '../../lib/format'
import type { Sale } from '../../types/pos'
import { Receipt, ReceiptPrintCopy } from './Receipt'

/** Confirmation after a sale: the change to hand back, and the receipt to print. */
export function SaleCompleteDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return (
    <Dialog open title="Sale complete" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {sale.changeDue > 0 && (
          <div className="rounded-xl bg-success-soft px-4 py-4 text-center" role="status">
            <div className="text-sm font-semibold text-success">Change to give</div>
            <div className="font-display text-4xl font-bold text-success tabular-nums">{formatMoney(sale.changeDue, sale.currency)}</div>
          </div>
        )}
        <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-border py-4 px-3">
          <Receipt sale={sale} />
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="h-14" onClick={() => window.print()}>
            Print receipt
          </Button>
          <Button className="h-14 flex-1 text-base" onClick={onClose} autoFocus>
            New sale
          </Button>
        </div>
        <ReceiptPrintCopy sale={sale} />
      </div>
    </Dialog>
  )
}
