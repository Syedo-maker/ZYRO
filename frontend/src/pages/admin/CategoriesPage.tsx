import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { categoriesApi } from '../../lib/categoriesApi'
import { can } from '../../lib/permissions'
import type { Category } from '../../types/api'

/** The server's own explanation (a duplicate name, a category still in use), or a fallback. */
const reason = (err: unknown, fallback: string) => (err as { detail?: string })?.detail ?? fallback

/**
 * The store's own categories: list, create, rename, enable or disable, delete. Every product is in
 * one of them, chosen from a dropdown on the product form, so a rename here shows on every product
 * in the category at once. A category with products cannot be deleted until they are moved.
 */
export function CategoriesPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  /** Why the last "Add category" did not add anything, shown under the field. */
  const [addError, setAddError] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const canManage = can(activeStore, 'products_write')

  const reload = useCallback(async () => {
    if (!storeId || !canManage) return
    try {
      setCategories(await categoriesApi.list(storeId))
    } catch (e) {
      setError(reason(e, 'Could not load your categories.'))
    } finally {
      setIsLoading(false)
    }
  }, [storeId, canManage])

  useEffect(() => {
    void reload()
  }, [reload])

  async function act(id: string | null, run: () => Promise<unknown>, done: string, failed: string) {
    setError(null)
    setNotice(null)
    setBusyId(id)
    try {
      await run()
      setNotice(done)
      await reload()
      return true
    } catch (e) {
      setError(reason(e, failed))
      return false
    } finally {
      setBusyId(null)
    }
  }

  /**
   * The button is never greyed out for an empty name: a click that cannot add anything says why,
   * next to the field, and puts the cursor there, rather than doing nothing at all.
   */
  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!storeId || adding) return
    const name = newName.trim()
    setError(null)
    setNotice(null)
    if (!name) {
      setAddError('Type a name for the new category first, for example "Toys".')
      newNameRef.current?.focus()
      return
    }
    setAddError(null)
    setAdding(true)
    try {
      await categoriesApi.create(storeId, name)
      setNewName('')
      setNotice(`Added "${name}". Choose it when you add or edit a product.`)
      await reload()
    } catch (err) {
      setAddError(reason(err, 'Could not add the category. Please try again.'))
      newNameRef.current?.focus()
    } finally {
      setAdding(false)
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault()
    if (!storeId || !renaming || busyId) return
    if (!renaming.name.trim()) {
      setRenameError('Type the new name first.')
      return
    }
    setRenameError(null)
    const ok = await act(renaming.id, () => categoriesApi.update(storeId, renaming.id, { name: renaming.name }), `Renamed to "${renaming.name.trim()}". Its products show the new name.`, 'Could not rename the category.')
    if (ok) setRenaming(null)
  }

  if (!activeStore || !storeId) {
    return <p className="text-text-secondary">No store found for this account yet.</p>
  }
  if (!canManage) {
    return (
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 className="font-display text-xl font-bold">Categories</h1>
        <Alert tone="info">
          Categories need the Products permission, which your account does not have in this store. Ask the store owner if you need it.
        </Alert>
      </div>
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-bold">Categories</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every product goes in one of your categories, and shoppers browse your shop by them. Create them here, then choose one when you
          add a product.
        </p>
      </div>

      <form onSubmit={handleAdd} noValidate className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Input
              ref={newNameRef}
              id="new-category"
              label="New category"
              maxLength={60}
              placeholder="For example: Toys"
              autoComplete="off"
              value={newName}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? 'new-category-error' : undefined}
              className={addError ? 'border-danger focus:border-danger' : ''}
              onChange={(e) => {
                setNewName(e.target.value)
                if (addError) setAddError(null)
              }}
            />
          </div>
          <Button type="submit" disabled={adding} aria-busy={adding || undefined}>
            {adding ? 'Adding…' : 'Add category'}
          </Button>
        </div>
        {addError && (
          <p id="new-category-error" role="alert" className="text-sm font-medium text-danger">
            {addError}
          </p>
        )}
      </form>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <div className="min-w-[520px]" role="table" aria-label="Categories">
          <div role="rowgroup">
            <div role="row" className="grid grid-cols-[2fr_1fr_1fr_190px] gap-3 border-b border-border px-5 py-3 text-[11px] font-bold text-text-muted">
              <div role="columnheader">CATEGORY</div>
              <div role="columnheader">PRODUCTS</div>
              <div role="columnheader">STATUS</div>
              <div role="columnheader"><span className="sr-only">Actions</span></div>
            </div>
          </div>

          {isLoading && <div className="px-5 py-6 text-sm text-text-secondary">Loading…</div>}
          {!isLoading && categories.length === 0 && !error && (
            <div className="px-5 py-10 text-center text-sm text-text-secondary">No categories yet. Add your first one above, then add products to it.</div>
          )}

          <div role="rowgroup">
            {categories.map((c) => (
              <div key={c.id} role="row" className="grid grid-cols-[2fr_1fr_1fr_190px] items-center gap-3 border-b border-border px-5 py-3 text-sm last:border-0">
                <div role="cell">
                  {renaming?.id === c.id ? (
                    <form onSubmit={handleRename} noValidate className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`rename-${c.id}`} className="sr-only">New name for {c.name}</label>
                      <input
                        id={`rename-${c.id}`}
                        autoFocus
                        maxLength={60}
                        value={renaming.name}
                        aria-invalid={renameError ? true : undefined}
                        aria-describedby={renameError ? `rename-${c.id}-error` : undefined}
                        onChange={(e) => {
                          setRenaming({ id: c.id, name: e.target.value })
                          if (renameError) setRenameError(null)
                        }}
                        className="h-9 min-w-0 flex-1 rounded-[10px] border border-border-input bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                      />
                      <Button type="submit" size="sm" disabled={busyId === c.id}>
                        {busyId === c.id ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenaming(null)
                          setRenameError(null)
                        }}
                      >
                        Cancel
                      </Button>
                      {renameError && (
                        <p id={`rename-${c.id}-error`} role="alert" className="basis-full text-xs font-medium text-danger">
                          {renameError}
                        </p>
                      )}
                    </form>
                  ) : (
                    <span className="font-semibold">{c.name}</span>
                  )}
                </div>
                <div role="cell">{c.productCount}</div>
                <div role="cell">{c.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}</div>
                <div role="cell" className="flex gap-3">
                  {renaming?.id !== c.id && (
                    <>
                      <button type="button" onClick={() => setRenaming({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`} className="text-xs font-semibold text-brand">
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() =>
                          void act(
                            c.id,
                            () => categoriesApi.update(storeId, c.id, { active: !c.active }),
                            c.active ? `Disabled "${c.name}". Its products stay listed; it cannot be chosen for new ones.` : `Enabled "${c.name}".`,
                            'Could not change the category.'
                          )
                        }
                        aria-label={`${c.active ? 'Disable' : 'Enable'} ${c.name}`}
                        className="text-xs font-semibold text-text-secondary"
                      >
                        {c.active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => {
                          if (!confirm(`Delete the category "${c.name}"?`)) return
                          void act(c.id, () => categoriesApi.remove(storeId, c.id), `Deleted "${c.name}".`, 'Could not delete the category.')
                        }}
                        aria-label={`Delete ${c.name}`}
                        className="text-xs font-semibold text-danger"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
