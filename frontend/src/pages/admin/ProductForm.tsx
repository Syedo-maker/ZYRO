import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { uploadsApi } from '../../lib/productsApi'
import { upgradeHintOf } from '../../lib/billingApi'
import { UpgradeNotice } from '../../components/billing/UpgradeNotice'
import { AiToolsPanel } from './AiToolsPanel'
import { WriteWithAi } from './WriteWithAi'
import { categoriesApi } from '../../lib/categoriesApi'
import { currencySymbol, formatMoney } from '../../lib/format'
import { percentLabel, pricesFromForm, switchDiscountMode, type DiscountSwitchMemo, type DiscountType } from '../../lib/prices'
import { StockStepper } from './StockStepper'
import type { Category, Product, ProductInput } from '../../types/api'
import type { ScoutPrefill } from '../../lib/productScoutApi'
import { Alert } from '../../components/ui/Alert'

/** The same comparison the server makes: case and spacing do not make two category names different. */
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

interface ProductFormProps {
  storeId: string
  /** The store's currency, for the "customers pay" line under the prices. */
  currency: string
  /** Present when editing; absent when creating. */
  initial?: Product
  /** A new product started from Product Scout's "Add to my store": name, category and a draft description. */
  prefill?: ScoutPrefill
  onSubmit: (input: ProductInput) => Promise<void>
  onCancel: () => void
}

export function ProductForm({ storeId, currency, initial, prefill, onSubmit, onCancel }: ProductFormProps) {
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? prefill?.description ?? '')
  // The three prices (the supervisor's product-listing change): the owner types the actual price (MRP)
  // and, optionally, a discount in money or as a percentage; the selling price customers pay is MRP
  // minus the discount, worked out as they type (lib/prices.ts, the server's rule) and shown as the
  // third, read-only field.
  const [actualPrice, setActualPrice] = useState(initial ? String(initial.actualPrice) : '')
  const [discountType, setDiscountType] = useState<DiscountType>(initial?.discountType ?? 'amount')
  const [discountValue, setDiscountValue] = useState(initial?.discountValue != null ? String(initial.discountValue) : '')
  const [switchMemo, setSwitchMemo] = useState<DiscountSwitchMemo | null>(null)
  const { prices: preview, problem: priceProblem } = pricesFromForm(actualPrice, discountType, discountValue)
  function switchDiscount(to: DiscountType) {
    const next = switchDiscountMode(actualPrice, discountValue, discountType, to, switchMemo)
    setDiscountType(to)
    setDiscountValue(next.text)
    setSwitchMemo(next.memo)
  }
  const [stock, setStock] = useState(initial?.stock.toString() ?? '')
  // Chosen from the store's own categories, never typed (the supervisor's product-listing change).
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [categoryHint, setCategoryHint] = useState<string | null>(null)
  useEffect(() => {
    categoriesApi
      .list(storeId)
      .then((list) => {
        setCategories(list)
        // A product listed before categories existed: pick its category by name, if it has one.
        if (initial && !initial.categoryId) {
          const match = list.find((c) => c.active && sameName(c.name, initial.category))
          if (match) setCategoryId(match.id)
        }
        // A Product Scout suggestion: its category when the store has it.
        if (!initial && prefill) {
          const match = list.find((c) => c.active && sameName(c.name, prefill.categoryName))
          if (match) setCategoryId(match.id)
        }
      })
      .catch(() => setCategories([]))
  }, [storeId, initial, prefill])
  // The suggested category, when the store does not have it yet: offered, created only on a click.
  const missingCategory =
    !initial && prefill && categories !== null && !categories.some((c) => c.active && sameName(c.name, prefill.categoryName)) ? prefill.categoryName : null
  const [creatingCategory, setCreatingCategory] = useState(false)
  async function createSuggestedCategory() {
    if (!missingCategory) return
    setCreatingCategory(true)
    try {
      const made = await categoriesApi.create(storeId, missingCategory)
      setCategories(await categoriesApi.list(storeId))
      setCategoryId(made.id)
    } catch (err) {
      setCategoryHint((err as { detail?: string }).detail ?? `Could not create "${missingCategory}".`)
    } finally {
      setCreatingCategory(false)
    }
  }
  const chosenCategory = categories?.find((c) => c.id === categoryId)
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [taxable, setTaxable] = useState(initial?.taxable ?? true)
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? '')
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? '')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const url = await uploadsApi.uploadImage(storeId, file)
      setImages((prev) => [...prev, url])
    } catch {
      setError('Image upload failed: only JPEG/PNG/WebP up to 5MB are accepted.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLimitError(null)
    if (priceProblem) {
      setError(`${priceProblem}.`)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({
        title,
        description,
        actualPrice: Number(actualPrice),
        // Empty or 0 means no discount; on an edit that removes one the product had.
        ...(preview?.discount
          ? { discountType: preview.discount.type, discountValue: preview.discount.value }
          : { discountType: null, discountValue: null }),
        stock: Number(stock),
        sku: sku.trim() || undefined,
        taxable,
        categoryId,
        images,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        seoTitle: seoTitle.trim() || undefined,
        seoDescription: seoDescription.trim() || undefined,
      })
    } catch (err) {
      if (upgradeHintOf(err)) {
        // The plan's product limit: show what to do about it instead of a vague "could not save".
        setLimitError(err)
      } else {
        const detail = (err as { detail?: string }).detail ?? ''
        setError(
          /SKU/.test(detail)
            ? 'That SKU is already used by another product.'
            : /price/i.test(detail)
              ? detail
              : 'Could not save this product. Please check the fields and try again.'
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-display text-base font-bold">{initial ? `Edit ${initial.title}` : 'Add product'}</h2>
      {prefill && !initial && (
        <Alert tone="info">
          Started from Product Scout: a suggested name, category and draft description from what is selling across ZYRO. Check them, add your own
          details and set your price. Nothing is published until you save.
        </Alert>
      )}

      {/* Issue 1: offered only when adding a product. An existing product already has a listing, and
          the AI tools panel below it handles rewriting one. */}
      {!initial && (
        <WriteWithAi
          storeId={storeId}
          draft={{
            title: title.trim() || undefined,
            category: chosenCategory?.name,
            description: description.trim() || undefined,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            price: preview?.sale,
          }}
          onUse={(idea) => {
            setTitle(idea.title)
            setDescription(idea.description)
          }}
        />
      )}

      <Input id="title" label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-xs font-semibold text-text-secondary">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-[10px] border border-border-input px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Prices</legend>
        <Input
          id="actualPrice"
          type="number"
          step="0.01"
          min="0.01"
          label="Price (MRP)"
          required
          value={actualPrice}
          onChange={(e) => {
            setActualPrice(e.target.value)
            setSwitchMemo(null)
          }}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="discountValue" className="text-xs font-semibold text-text-secondary">
            Discount (optional)
          </label>
          <div className="flex gap-2">
            <input
              id="discountValue"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              aria-describedby="price-preview"
              aria-invalid={priceProblem !== null && discountValue.trim() !== '' ? true : undefined}
              placeholder={discountType === 'percent' ? 'e.g. 15' : 'e.g. 200'}
              value={discountValue}
              onChange={(e) => {
                setDiscountValue(e.target.value)
                setSwitchMemo(null)
              }}
              className="h-11 min-w-0 flex-1 rounded-[10px] border border-border-input bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            {/* Rs or %: switching converts the value (Rs 150 off a 1,000 MRP is 15%), and switching straight back restores it. */}
            <div role="group" aria-label="Discount in" className="flex shrink-0 rounded-[10px] border border-border-input p-0.5">
              {(['amount', 'percent'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={discountType === t}
                  aria-label={t === 'amount' ? `Discount in ${currency}` : 'Discount in percent'}
                  onClick={() => switchDiscount(t)}
                  className={`h-9 min-w-11 rounded-lg px-3 text-sm font-semibold ${discountType === t ? 'bg-brand text-on-brand' : 'text-text-secondary hover:text-text'}`}
                >
                  {t === 'amount' ? currencySymbol(currency) : '%'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* The third price: what customers pay. Shown, never typed, so it cannot disagree with the other two. */}
        <Input
          id="sellingPrice"
          label="Selling price (what customers pay)"
          readOnly
          aria-describedby="price-preview"
          value={preview ? formatMoney(preview.sale, currency) : ''}
          placeholder="Fills in from the prices above"
          className="font-semibold"
        />
        <p id="price-preview" aria-live="polite" className={`-mt-1.5 text-xs ${priceProblem ? 'text-danger' : 'text-text-secondary'}`}>
          {priceProblem
            ? `${priceProblem}.`
            : preview?.discount
              ? `${formatMoney(preview.actual, currency)} minus ${
                  preview.discount.type === 'percent' ? `${percentLabel(preview.discount.value)}% (${formatMoney(preview.discountAmount, currency)})` : formatMoney(preview.discountAmount, currency)
                }: customers pay ${formatMoney(preview.sale, currency)}.`
              : preview
                ? `No discount: customers pay the MRP, ${formatMoney(preview.sale, currency)}.`
                : 'Leave the discount empty to sell at the MRP.'}
        </p>
      </fieldset>

      <StockStepper id="stock" label="Stock" value={stock} onChange={setStock} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="category" className="text-xs font-semibold text-text-secondary">
          Category
        </label>
        {categories !== null && categories.filter((c) => c.active).length === 0 ? (
          // Nothing to choose from yet: say what to do instead of showing an empty dropdown.
          <p className="rounded-[10px] border border-border bg-bg px-3.5 py-3 text-sm text-text-secondary">
            You have no categories yet.{' '}
            <Link to="/admin/categories" className="font-semibold text-brand underline underline-offset-2">
              Create a category
            </Link>{' '}
            first, then come back to add this product.
          </p>
        ) : (
          <select
            id="category"
            required
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value)
              setCategoryHint(null)
            }}
            className="h-11 rounded-[10px] border border-border-input bg-surface px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            <option value="" disabled>
              {categories === null ? 'Loading categories…' : 'Choose a category'}
            </option>
            {(categories ?? [])
              .filter((c) => c.active || c.id === categoryId)
              .map((c) => (
                // A disabled category stays visible for the product already in it, but cannot be saved.
                <option key={c.id} value={c.id} disabled={!c.active}>
                  {c.active ? c.name : `${c.name} (disabled)`}
                </option>
              ))}
          </select>
        )}
        {chosenCategory && !chosenCategory.active && (
          <span className="text-xs text-text-secondary">
            This category is disabled: this product can stay in it, but no other product can be added to it. Enable it on the Categories page to use it again.
          </span>
        )}
        {missingCategory && (
          <span className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            “{missingCategory}” is not one of your categories yet.
            <button type="button" onClick={() => void createSuggestedCategory()} disabled={creatingCategory} className="font-semibold text-brand underline underline-offset-2">
              {creatingCategory ? 'Creating…' : `Create “${missingCategory}”`}
            </button>
          </span>
        )}
        {categoryHint && <span className="text-xs text-text-secondary">{categoryHint}</span>}
      </div>

      <div>
        <Input id="sku" label="SKU (optional)" maxLength={100} value={sku} onChange={(e) => setSku(e.target.value)} />
        <p className="mt-1 text-xs text-text-secondary">Unique in your store. The register finds the product by it.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="h-4 w-4" />
        Charge sales tax on this product
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-text-secondary">Images</span>
        <div className="flex gap-2 flex-wrap">
          {images.map((url) => (
            <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-4"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label={uploading ? 'Uploading image' : 'Add image'}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || images.length >= 10}
            className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-text-muted text-xs disabled:opacity-50"
          >
            {uploading ? '…' : '+'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Product image file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void handleFileSelected(e)}
          />
        </div>
      </div>

      <Input
        id="tags"
        label="Tags (comma-separated, optional)"
        placeholder="mug, ceramic, coffee"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input id="seoTitle" label="Meta title (optional)" maxLength={70} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
        <Input id="seoDescription" label="Meta description (optional)" maxLength={160} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
      </div>

      {initial && (
        <AiToolsPanel
          storeId={storeId}
          productId={initial.id}
          onApplyDescription={(text) => setDescription(text)}
          onApplyCategoryAndTags={(suggestedCategory, suggestedTags) => {
            // The AI suggests a name; only one of the store's own active categories can be chosen.
            const match = categories?.find((c) => c.active && sameName(c.name, suggestedCategory))
            if (match) {
              setCategoryId(match.id)
              setCategoryHint(null)
            } else {
              setCategoryHint(`The AI suggested "${suggestedCategory}", which is not one of your categories. Create it on the Categories page if you want it.`)
            }
            setTags(suggestedTags.join(', '))
          }}
          onApplySeo={(title, desc) => {
            setSeoTitle(title)
            setSeoDescription(desc)
          }}
        />
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <UpgradeNotice error={limitError} />

      <div className="flex gap-3 mt-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={submitting || uploading}>
          {submitting ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
