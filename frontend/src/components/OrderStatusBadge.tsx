import { Badge } from './ui/Badge'
import { ORDER_STATUS_META } from '../lib/orderStatus'
import type { OrderStatus } from '../types/commerce'

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const meta = ORDER_STATUS_META[status]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}
