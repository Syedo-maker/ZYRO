import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { storeSettingsApi } from '../../lib/storeSettingsApi'

/**
 * The owner's choice about the platform's shared trends (Product Scout and Trend Scout).
 *
 * On by default: the trends are anonymous totals from many shops' paid orders, and they only work if
 * shops take part. But it is the owner's sales, so one switch leaves them out from the next daily
 * update. The shop keeps seeing the trends either way; nothing else changes.
 */
export function TrendSharingPanel({ storeId }: { storeId: string }) {
  const [current, setCurrent] = useState<boolean | null>(null)
  const [share, setShare] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const s = await storeSettingsApi.trendSharing(storeId)
    setCurrent(s.shareSalesInTrends)
    setShare(s.shareSalesInTrends)
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e, 'Could not load your trend sharing setting.')))
  }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const s = await storeSettingsApi.setTrendSharing(storeId, share)
      setCurrent(s.shareSalesInTrends)
      setShare(s.shareSalesInTrends)
      setSaved(
        s.shareSalesInTrends
          ? "Your shop's sales will count toward the shared trends from the next daily update."
          : "Your shop's sales will be left out of the shared trends from the next daily update.",
      )
    } catch (err) {
      setError(errorMessage(err, 'Could not save your trend sharing setting.'))
    } finally {
      setSaving(false)
    }
  }

  if (current === null) return error ? <Alert>{error}</Alert> : <Spinner label="Loading your trend sharing setting" />

  return (
    <section aria-label="Shared trends" className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-display text-base font-bold">Shared trends</h2>
      <p className="mt-1 text-sm text-text-secondary">
        Product Scout and Trend Scout show every shop what is selling across ZYRO, as totals from many shops' paid orders. No shop, customer
        or order is ever named, and a total is only shown when enough shops sold it and no one or two shops make up most of it.
      </p>

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <Alert tone="success">{saved}</Alert>
        </div>
      )}

      <form onSubmit={save} className="mt-4 flex flex-col gap-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => {
              setShare(e.target.checked)
              setSaved(null)
            }}
            className="mt-0.5 h-4 w-4"
          />
          <span>Include my shop's sales in shared platform trends</span>
        </label>
        <p className="text-xs text-text-muted">
          When this is off, your orders are left out of every shared total from the next daily update. You can still see the trends either way.
        </p>
        <div>
          <Button type="submit" disabled={saving || share === current}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  )
}
