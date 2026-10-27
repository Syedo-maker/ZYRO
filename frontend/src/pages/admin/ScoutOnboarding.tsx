import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { categoriesApi } from '../../lib/categoriesApi'
import { prefillFrom, type ProductScout, type ScoutPrefill, type ScoutProduct } from '../../lib/productScoutApi'

/** The same comparison the server makes: case and spacing do not make two category names different. */
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

type Step = 'type' | 'categories' | 'products'

/**
 * Getting a new store started, inside the Trending products panel: what the shop sells, then the
 * categories to create (each made only when the owner says so), then starter products from what is
 * selling across ZYRO. Nothing is created or added without a click; any step can be skipped.
 */
export function ScoutOnboarding({
  storeId,
  data,
  categoryOptions,
  onAdd,
  onChanged,
  onDone,
}: {
  storeId: string
  data: ProductScout
  categoryOptions: string[]
  onAdd: (prefill: ScoutPrefill) => void
  /** Called after categories are created, so the panel reloads what the store now has. */
  onChanged: () => void
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>(data.store.categories.length === 0 ? 'type' : 'products')
  const [chosen, setChosen] = useState<string[]>(data.store.categories.map((c) => c.name))
  const [other, setOther] = useState('')
  const [toCreate, setToCreate] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [created, setCreated] = useState<string[]>([])

  const existing = data.store.categories.map((c) => c.name)
  const exists = (name: string) => existing.some((e) => sameName(e, name)) || created.some((c) => sameName(c, name))
  const choices = useMemo(() => [...new Set([...categoryOptions, ...existing])], [categoryOptions, existing])

  const allProducts = useMemo(() => {
    const byId = new Map<string, ScoutProduct>()
    for (const p of [...data.topSellers, ...data.fastestGrowing, ...data.rising.flatMap((r) => r.products)]) byId.set(p.id, p)
    return [...byId.values()]
  }, [data])
  const starters = allProducts.filter((p) => chosen.some((c) => sameName(c, p.categoryName)))

  const toggle = (name: string) => setChosen((list) => (list.some((c) => sameName(c, name)) ? list.filter((c) => !sameName(c, name)) : [...list, name]))

  function goToCategories() {
    const names = [...chosen, ...(other.trim() ? [other.trim()] : [])]
    setChosen(names)
    setToCreate(names.filter((n) => !exists(n)))
    setStep('categories')
  }

  async function createCategories() {
    setBusy(true)
    setProblem(null)
    const made: string[] = []
    for (const name of toCreate) {
      try {
        await categoriesApi.create(storeId, name)
        made.push(name)
      } catch (e) {
        // Already there (made in another tab): fine. Anything else is said and the rest carry on.
        if ((e as { status?: number }).status !== 409) setProblem((e as { detail?: string }).detail ?? `Could not create "${name}".`)
        else made.push(name)
      }
    }
    setCreated((c) => [...c, ...made])
    setBusy(false)
    onChanged()
    setStep('products')
  }

  return (
    <section aria-label="Get your shop started" className="flex flex-col gap-3">
      <div>
        <h3 className="font-display text-sm font-bold">Let's set up your shop</h3>
        <p className="text-xs text-text-secondary">
          Step {step === 'type' ? 1 : step === 'categories' ? 2 : 3} of 3. Nothing is created until you confirm it.
        </p>
      </div>

      {step === 'type' && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">What does your shop sell?</legend>
            {choices.length === 0 && <p className="text-xs text-text-secondary">No trends to suggest from yet; type what you sell below.</p>}
            <div className="flex flex-wrap gap-2">
              {choices.map((name) => {
                const on = chosen.some((c) => sameName(c, name))
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(name)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-brand bg-brand-soft text-brand' : 'border-border text-text-secondary hover:bg-bg'}`}
                  >
                    {on ? '✓ ' : ''}
                    {name}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <Input id="scout-other-category" label="Something else? (optional)" maxLength={60} placeholder="For example: Shoes" value={other} onChange={(e) => setOther(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" onClick={goToCategories} disabled={chosen.length === 0 && !other.trim()}>
              Next
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              Skip, I'll set up myself
            </Button>
          </div>
        </>
      )}

      {step === 'categories' && (
        <>
          <p className="text-sm font-semibold">Categories for your shop</p>
          <ul className="flex flex-col gap-1.5">
            {chosen.map((name) => {
              const already = exists(name)
              const on = toCreate.some((c) => sameName(c, name))
              return (
                <li key={name} className="flex items-center gap-2 text-sm">
                  {already ? (
                    <span className="text-text-secondary">✓ {name} (already in your shop)</span>
                  ) : (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setToCreate((list) => (on ? list.filter((c) => !sameName(c, name)) : [...list, name]))}
                        className="h-4 w-4"
                      />
                      Create “{name}”
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
          {problem && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void createCategories()} disabled={busy || toCreate.length === 0}>
              {busy ? 'Creating…' : `Create ${toCreate.length} ${toCreate.length === 1 ? 'category' : 'categories'}`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep('products')}>
              {toCreate.length === 0 ? 'Next' : 'Skip this'}
            </Button>
          </div>
        </>
      )}

      {step === 'products' && (
        <>
          {created.length > 0 && <p className="text-sm text-success">Created: {created.join(', ')}.</p>}
          <p className="text-sm font-semibold">Starter products selling well across ZYRO</p>
          {starters.length === 0 ? (
            <p className="text-sm text-text-secondary">No trending products in your categories yet. Add your own from the Products page.</p>
          ) : (
            <ul className="flex flex-col">
              {starters.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 border-b border-border py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs tabular-nums text-text-secondary">
                      {p.categoryName} · {p.units} sold in {p.stores} shops
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAdd(prefillFrom(p))}
                    className="shrink-0 rounded-[8px] border border-brand px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
                    aria-label={`Add ${p.name} to my store`}
                  >
                    Add to my store
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button type="button" variant="secondary" onClick={onDone}>
              Done, show me the trends
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
