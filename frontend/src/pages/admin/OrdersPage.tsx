import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { ORDER_STATUS_META } from '../../lib/orderStatus'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage, ordersApi } from '../../lib/ordersApi'
import { storefrontApi } from '../../lib/storefrontApi'
import type { Order, OrderStatus, SalesChannel } from '../../types/commerce'
import { OrderDetailPanel } from './OrderDetailPanel'
import { ShippingZonesPanel } from './ShippingZonesPanel'

const PAGE_SIZE = 20
const TABS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: ORDER_STATUS_META.paid.label },
  { key: 'fulfilled', label: ORDER_STATUS_META.fulfilled.label },
  { key: 'completed', label: ORDER_STATUS_META.completed.label },
  { key: 'cancelled', label: ORDER_STATUS_META.cancelled.label },
  { key: 'refunded', label: ORDER_STATUS_META.refunded.label },
]

const customerName = (o: Order) => o.customer?.name ?? o.customer?.email ?? o.guestEmail ?? 'Guest'

export function OrdersPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [tab, setTab] = useState<OrderStatus | 'all'>('all')
  const [channel, setChannel] = useState<SalesChannel | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Partial<Record<OrderStatus | 'all', number>>>({})
  const [selected, setSelected] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')

  useEffect(() => {
    if (!storeId) return
    storefrontApi.getStore(storeId).then((s) => setCurrency(s.currency)).catch(() => undefined)
  }, [storeId])

  // Debounce typing so the list is not refetched on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setOffset(0)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const loadCounts = useCallback(async () => {
    if (!storeId) return
    const filters = channel ? { channel, q: search || undefined } : { q: search || undefined }
    const results = await Promise.all(
      TABS.map((t) => ordersApi.list(storeId, { ...filters, status: t.key === 'all' ? undefined : t.key, limit: 1 }))
    )
    setCounts(Object.fromEntries(TABS.map((t, i) => [t.key, results[i].pagination.total])))
  }, [storeId, channel, search])

  const loadOrders = useCallback(async () => {
    if (!storeId) return
    try {
      const res = await ordersApi.list(storeId, {
        status: tab === 'all' ? undefined : tab,
        channel: channel || undefined,
        q: search || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setOrders(res.data)
      setTotal(res.pagination.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
      setOrders([])
    }
  }, [storeId, tab, channel, search, offset])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])
  useEffect(() => {
    void loadCounts().catch(() => undefined)
  }, [loadCounts])

  function handleChanged(updated: Order) {
    setSelected(updated)
    void loadOrders()
    void loadCounts().catch(() => undefined)
  }

  if (!activeStore) return <p className="text-text-secondary">No store found for this account yet.</p>

  const pickTab = (key: OrderStatus | 'all') => {
    setTab(key)
    setOffset(0)
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-xl font-bold">Orders</h1>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-white lg:flex-row">
        <div className="min-w-0 flex-1">
          <div role="tablist" aria-label="Order status" className="flex gap-1 overflow-x-auto px-4 pt-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => pickTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] ${
                  tab === t.key ? 'border-brand font-semibold text-brand' : 'border-transparent font-medium text-text-muted hover:text-text'
                }`}
              >
                {t.label}
                {counts[t.key] !== undefined && ` (${counts[t.key]})`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <input
              type="search"
              aria-label="Search orders by number or email"
              placeholder="Search by order number or email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-10 min-w-[220px] flex-1 rounded-[10px] border border-border px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <select
              aria-label="Sales channel"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as SalesChannel | '')
                setOffset(0)
              }}
              className="h-10 rounded-[10px] border border-border bg-white px-3 text-sm"
            >
              <option value="">All channels</option>
              <option value="online">Online</option>
              <option value="pos">In-store (POS)</option>
            </select>
          </div>

          {error && <div className="p-4"><Alert>{error}</Alert></div>}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] font-bold text-text-muted">
                  {['ORDER', 'CUSTOMER', 'DATE', 'CHANNEL', 'TOTAL', 'STATUS'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 font-bold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders?.map((o) => (
                  <tr key={o.id} className={`border-t border-border ${selected?.id === o.id ? 'bg-brand-soft' : 'hover:bg-bg'}`}>
                    <td className="px-4 py-3.5">
                      <button type="button" onClick={() => setSelected(o)} aria-pressed={selected?.id === o.id} className="font-semibold text-brand hover:underline">
                        #{o.orderNumber}
                      </button>
                    </td>
                    <td className="px-4 py-3.5">{customerName(o)}</td>
                    <td className="px-4 py-3.5 text-text-muted">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-3.5 text-text-secondary">{o.channel === 'pos' ? 'In-store' : 'Online'}</td>
                    <td className="px-4 py-3.5 font-semibold">{formatMoney(o.total, o.currency)}</td>
                    <td className="px-4 py-3.5"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {orders === null && <p className="px-5 py-6 text-sm text-text-secondary">Loading orders…</p>}
          {orders?.length === 0 && !error && (
            <p className="px-5 py-12 text-center text-sm text-text-secondary">
              {tab === 'all' && !search && !channel ? 'No orders yet. They will appear here as customers buy.' : 'No orders match these filters.'}
            </p>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-text-secondary">
              <span>{offset + 1} to {Math.min(offset + PAGE_SIZE, total)} of {total}</span>
              <div className="flex gap-2">
                <Button variant="secondary" className="h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
                <Button variant="secondary" className="h-9" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <OrderDetailPanel key={selected.id} order={selected} storeId={activeStore.id} onChanged={handleChanged} onClose={() => setSelected(null)} />
        )}
      </div>

      <ShippingZonesPanel storeId={activeStore.id} currency={currency} />
    </div>
  )
}
