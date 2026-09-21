import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useStore } from '../../../context/StoreContext'
import { OrderStatusBadge } from '../../../components/OrderStatusBadge'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Spinner } from '../../../components/ui/Spinner'
import { formatDate, formatMoney } from '../../../lib/format'
import { errorMessage } from '../../../lib/ordersApi'
import { accountApi } from '../../../lib/shopApi'
import type { Order } from '../../../types/commerce'

const PAGE = 10

/** The signed-in shopper's page: who they are, and every order they have placed at this store. */
export function AccountPage() {
  const store = useStore()
  const { user, isAuthenticated, isLoading, logout } = useAuth()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(
    async (offset: number) => {
      const r = await accountApi.myOrders(store.id, { limit: PAGE, offset })
      setTotal(r.pagination.total)
      setOrders((cur) => (offset === 0 ? r.data : [...(cur ?? []), ...r.data]))
    },
    [store.id]
  )

  useEffect(() => {
    if (!isAuthenticated) return
    load(0).catch((e) => setError(errorMessage(e)))
  }, [isAuthenticated, load])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to={`/store/${store.id}/account/login?next=${encodeURIComponent(`/store/${store.id}/account`)}`} replace />

  async function showMore() {
    setLoadingMore(true)
    try {
      await load(orders?.length ?? 0)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{user?.name ? `Hello, ${user.name}` : 'Your account'}</h1>
          <p className="mt-1 text-sm text-text-secondary">{user?.email}</p>
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            await logout()
            navigate(`/store/${store.id}`)
          }}
        >
          Sign out
        </Button>
      </div>

      <section aria-labelledby="orders-heading" className="flex flex-col gap-4">
        <h2 id="orders-heading" className="font-display text-lg font-bold">
          Your orders
        </h2>
        {error && <Alert>{error}</Alert>}
        {orders === null && !error && <Spinner label="Loading your orders" />}
        {orders?.length === 0 && (
          <div className="rounded-2xl border border-border bg-white px-6 py-12 text-center">
            <p className="text-sm text-text-secondary">You have no orders at {store.name} yet.</p>
            <Link to={`/store/${store.id}/products`} className="mt-3 inline-block text-sm font-semibold text-brand">
              Start shopping
            </Link>
          </div>
        )}
        <ul className="flex flex-col gap-3">
          {orders?.map((o) => (
            <li key={o.id}>
              <Link to={`/store/${store.id}/account/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 hover:border-brand">
                <div>
                  <p className="text-sm font-bold">
                    Order #{o.orderNumber} <span className="ml-2 font-normal text-text-secondary">{formatDate(o.createdAt)}</span>
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {o.items.map((i) => `${i.quantity} x ${i.productTitleSnapshot}`).join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <OrderStatusBadge status={o.status} />
                  <span className="text-sm font-bold">{formatMoney(o.total, o.currency)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {orders && orders.length < total && (
          <Button variant="secondary" className="self-center" onClick={() => void showMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : `Show more orders (${total - orders.length} left)`}
          </Button>
        )}
      </section>
    </div>
  )
}
