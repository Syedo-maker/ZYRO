import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { uploadsApi } from '../../lib/productsApi'
import type { Product, ProductInput } from '../../types/api'

interface ProductFormProps {
  storeId: string
  /** Present when editing; absent when creating. */
  initial?: Product
  onSubmit: (input: ProductInput) => Promise<void>
  onCancel: () => void
}

export function ProductForm({ storeId, initial, onSubmit, onCancel }: ProductFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [price, setPrice] = useState(initial?.price.toString() ?? '')
  const [stock, setStock] = useState(initial?.stock.toString() ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [images, setImages] = useState<string[]>(initial?.images ?? [])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError('Image upload failed — only JPEG/PNG/WebP up to 5MB are accepted.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        title,
        description,
        price: Number(price),
        stock: Number(stock),
        category,
        images,
      })
    } catch {
      setError('Could not save this product. Please check the fields and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-display text-base font-bold">{initial ? `Edit ${initial.title}` : 'Add product'}</h2>

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
          className="rounded-[10px] border border-border px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          id="price"
          type="number"
          step="0.01"
          min="0"
          label="Price"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          id="stock"
          type="number"
          min="0"
          label="Stock"
          required
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
      </div>

      <Input id="category" label="Category" required value={category} onChange={(e) => setCategory(e.target.value)} />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-text-secondary">Images</span>
        <div className="flex gap-2 flex-wrap">
          {images.map((url) => (
            <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] leading-4"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || images.length >= 10}
            className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-text-muted text-xs disabled:opacity-50"
          >
            {uploading ? '…' : '+'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void handleFileSelected(e)} />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

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
