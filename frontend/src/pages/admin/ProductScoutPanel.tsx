import { useCallback, useEffect, useId, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Badge } from '../../components/ui/Badge'
import { Spinner } from '../../components/ui/Spinner'
import { can } from '../../lib/permissions'
import { errorMessage } from '../../lib/ordersApi'
import { prefillFrom, productScoutApi, type ProductScout, type ScoutPrefill, type ScoutProduct } from '../../lib/productScoutApi'
import { ScoutOnboarding } from './ScoutOnboarding'

const remember = (key: string, value?: string) => {
  try {
    if (value === undefined) return window.localStorage.getItem(key)
    window.localStorage.setItem(key, value)
  } catch {
    // Private windows and blocked storage: the panel simply opens in its default state next time.
  }
  return null
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The growth as a word and an arrow, never colour alone. */
function Growth({ p }: { p: ScoutProduct }) {
  if (p.isNew) return <Badge tone="ai">New this period</Badge>
  if (p.growthPercent === null) return null
  if (p.growthPercent > 0) return <Badge tone="success">↑ {p.growthPercent}%</Badge>
  if (p.growthPercent < 0) return <Badge tone="neutral">↓ {Math.abs(p.growthPercent)}%</Badge>
  return <Badge tone="neutral">No change</Badge>
}

function Item({ p, periodDays, onAdd }: { p: ScoutProduct; periodDays: number; onAdd: (prefill: ScoutPrefill) => void }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-border py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{p.name}</p>
          <p className="text-xs text-text-secondary">{p.categoryName}</p>
        </div>
        <Growth p={p} />
      </div>
      <p className="text-xs tabular-nums text-text-secondary">
        {p.units} sold · {p.orders} orders · {p.stores} shops · last {periodDays} days
        {p.previousUnits !== null && <> · {p.previousUnits} before</>}
      </p>
      <p className="text-sm">
        <span className="sr-only">Why it is trending: </span>
        {p.why}
      </p>
      <div>
        <button
          type="button"
          onClick={() => onAdd(prefillFrom(p))}
          className="rounded-[8px] border border-brand px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
          aria-label={`Add ${p.name} to my store`}
        >
          Add to my store
        </button>
      </div>
    </li>
  )
}

function Section({ title, products, periodDays, onAdd, empty }: { title: string; products: ScoutProduct[]; periodDays: number; onAdd: (p: ScoutPrefill) => void; empty?: string }) {
  if (products.length === 0 && !empty) return null
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">{title}</h3>
      {products.length === 0 ? (
        <p className="py-2 text-sm text-text-secondary">{empty}</p>
      ) : (
        <ul>
          {products.map((p) => (
            <Item key={p.id} p={p} periodDays={periodDays} onAdd={onAdd} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Product Scout's "Trending products" panel: what is selling across ZYRO shops in this store's market,
 * from the daily snapshot (opening it never runs a calculation or an AI call). Every figure is a total
 * from at least a few shops, never one shop's own. "Add to my store" hands the Add Product form a
 * suggested name, category and draft description; nothing is saved until the owner saves the form.
 * A store with no products or no categories is walked through setting up first. Owner and Managers
 * only (the Products permission). Collapses to a slim tab; remembers that per page.
 */
export function ProductScoutPanel({
  page,
  onAdd,
  forceCollapsed = false,
}: {
  page: 'dashboard' | 'products'
  onAdd: (prefill: ScoutPrefill) => void
  /** The Products page folds it away while the product form is open. */
  forceCollapsed?: boolean
}) {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const allowed = can(activeStore, 'products_write')
  const bodyId = useId()
  const openKey = `zyro.scout.open.${page}`
  const [open, setOpen] = useState(() => remember(openKey) !== 'no')
  const [period, setPeriod] = useState<7 | 30>(7)
  const [category, setCategory] = useState('')
  const [data, setData] = useState<ProductScout | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => (storeId ? remember(`zyro.scout.onboarded.${storeId}`) === 'yes' : false))

  const load = useCallback(async () => {
    if (!storeId || !allowed) return
    setLoading(true)
    setError(null)
    try {
      const result = await productScoutApi.get(storeId, period, category || undefined)
      setData(result)
      if (!category) {
        // The filter offers every category in the unfiltered view, so choosing one never hides the rest from the list.
        const names = new Set([...result.categories.map((c) => c.name), ...result.topSellers.map((p) => p.categoryName), ...result.marketData.map((m) => m.name)])
        setCategoryOptions([...names].sort((a, b) => a.localeCompare(b)))
      }
    } catch (e) {
      setError(errorMessage(e, 'Could not load trending products.'))
    } finally {
      setLoading(false)
    }
  }, [storeId, allowed, period, category])

  useEffect(() => {
    void load()
  }, [load])

  if (!allowed || !storeId) return null

  const isOpen = open && !forceCollapsed
  const toggle = () => {
    const next = !isOpen
    setOpen(next)
    remember(openKey, next ? 'yes' : 'no')
  }
  const needsSetup = !!data && (data.store.productCount === 0 || data.store.categories.length === 0) && !onboardingDismissed
  const finishOnboarding = () => {
    setOnboardingDismissed(true)
    remember(`zyro.scout.onboarded.${storeId}`, 'yes')
  }

  if (!isOpen) {
    return (
      <aside aria-label="Trending products" className="lg:sticky lg:top-4 lg:self-start">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-controls={bodyId}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft lg:h-48 lg:w-10 lg:flex-col lg:px-0 lg:[writing-mode:vertical-rl]"
        >
          <span aria-hidden="true">‹</span> Trending products
        </button>
      </aside>
    )
  }

  return (
    <aside aria-label="Trending products" className="w-full shrink-0 lg:sticky lg:top-4 lg:w-[340px] lg:self-start">
      <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-start justify-between gap-2 border-b border-border p-4">
          <div>
            <h2 className="font-display text-base font-bold">
              Trending products {data?.demo && <Badge tone="warning">Demo data</Badge>}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              What is selling across ZYRO shops in your market{data ? ` (${data.market})` : ''}
              {data?.window ? `, ${shortDate(data.window.from)} to ${shortDate(data.window.to)}` : ''}.
            </p>
          </div>
          <button type="button" onClick={toggle} aria-expanded={true} aria-controls={bodyId} className="rounded-[8px] px-2 py-1 text-sm font-semibold text-text-secondary hover:bg-bg" aria-label="Collapse trending products">
            ›
          </button>
        </div>

        <div id={bodyId} className="flex flex-col gap-4 overflow-y-auto p-4">
          {needsSetup && data ? (
            <ScoutOnboarding storeId={storeId} data={data} categoryOptions={categoryOptions} onAdd={onAdd} onChanged={load} onDone={finishOnboarding} />
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div role="group" aria-label="Period" className="flex rounded-[10px] border border-border-input p-0.5">
                  {([7, 30] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={period === d}
                      onClick={() => setPeriod(d)}
                      className={`rounded-[8px] px-2.5 py-1 text-xs font-semibold ${period === d ? 'bg-brand text-on-brand' : 'text-text-secondary hover:bg-bg'}`}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
                <label className="sr-only" htmlFor={`${bodyId}-category`}>
                  Category
                </label>
                <select
                  id={`${bodyId}-category`}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-[10px] border border-border-input bg-surface px-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                >
                  <option value="">All categories</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {loading && !data && <Spinner label="Loading trending products" />}
              {error && (
                <div role="alert" className="text-sm text-danger">
                  {error}{' '}
                  <button type="button" onClick={() => void load()} className="font-semibold underline">
                    Try again
                  </button>
                </div>
              )}

              {data && (
                <div className={`flex flex-col gap-5 ${loading ? 'opacity-60' : ''}`} aria-busy={loading || undefined}>
                  {data.status === 'no_data' ? (
                    <p className="text-sm text-text-secondary">
                      Not enough sales across ZYRO shops in your market yet to show trends without pointing to any one shop. Check back as more
                      orders come in.
                    </p>
                  ) : (
                    <>
                      <Section title="Top sellers" products={data.topSellers} periodDays={data.periodDays} onAdd={onAdd} empty="Nothing in this category passes the privacy rules yet." />
                      <Section title="Fastest growing" products={data.fastestGrowing} periodDays={data.periodDays} onAdd={onAdd} />
                      {data.rising.map((r) => (
                        <Section key={r.category} title={`Rising in ${r.name}`} products={r.products} periodDays={data.periodDays} onAdd={onAdd} />
                      ))}
                    </>
                  )}

                  {data.marketData.map((m) => (
                    <section key={m.category} aria-label={`Market data: ${m.name}`} className="rounded-xl border border-dashed border-border p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone="warning">Market data</Badge>
                        <span className="text-sm font-semibold">{m.name}</span>
                      </div>
                      <p className="mb-1 text-xs text-text-secondary">Not enough ZYRO sales yet, so this is from outside sources, not ZYRO shops.</p>
                      <ul className="list-disc pl-4 text-sm">
                        {m.lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-text-muted">Source: {m.sources.join(', ')}</p>
                    </section>
                  ))}

                  {data.notEnoughData.length > 0 && (
                    <p className="text-xs text-text-secondary">Not enough data yet for: {data.notEnoughData.join(', ')}.</p>
                  )}

                  <p className="text-xs text-text-muted">
                    Totals from at least {data.rules.minStores} shops, where no shop sold more than {data.rules.maxSharePercent}% and no two
                    shops more than {data.rules.maxTopTwoSharePercent}% together. No shop, customer or order is ever named. Updated daily.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
