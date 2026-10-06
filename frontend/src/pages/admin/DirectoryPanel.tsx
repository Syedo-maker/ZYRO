import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { storeSettingsApi } from '../../lib/storeSettingsApi'
import type { DirectoryListing } from '../../types/directory'

/**
 * The owner's control over the public shop directory at /shop (Issue 2).
 *
 * Listing is on by default, because a shop that nobody can find does not sell anything, but it is
 * the owner's shop and the owner's decision, so one switch turns it off. The panel also says
 * whether the shop is actually appearing right now: a shop with too few products is held back
 * whatever the switch says, and that is worth stating rather than leaving the owner to wonder.
 */
export function DirectoryPanel({ storeId }: { storeId: string }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [listed, setListed] = useState(true)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const l = await storeSettingsApi.directoryListing(storeId)
    setListing(l)
    setListed(l.listedInDirectory)
    setDescription(l.description ?? '')
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e, 'Could not load your directory settings.')))
  }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await storeSettingsApi.setDirectoryListing(storeId, {
        listedInDirectory: listed,
        description: description.trim() === '' ? null : description.trim(),
      })
      await load()
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err, 'Could not save your directory settings.'))
    } finally {
      setSaving(false)
    }
  }

  if (!listing) return error ? <Alert>{error}</Alert> : <Spinner label="Loading your directory settings" />

  return (
    <section aria-label="Public directory" className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-display text-base font-bold">Public directory</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Shoppers who arrive at ZYRO without a shop in mind see a list of shops. Only your shop name, logo, category and the line below are shown there.
      </p>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <Alert tone="success">Your directory settings are saved.</Alert>
        </div>
      )}

      <form onSubmit={save} className="mt-4 flex flex-col gap-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>List my store in the public directory</span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="store-description" className="text-xs font-semibold text-text-secondary">
            One line about your shop (optional)
          </label>
          <textarea
            id="store-description"
            rows={2}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Hand-made pottery from Multan, fired in small batches."
            className="rounded-[10px] border border-border px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <p className="text-xs text-text-muted">{200 - description.length} characters left. Anyone can read this.</p>
        </div>

        <p className="text-sm text-text-secondary">
          {listing.listed
            ? `Your shop is listed now, with ${listing.productCount} ${listing.productCount === 1 ? 'product' : 'products'}.`
            : listing.reason}
        </p>

        <div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  )
}
