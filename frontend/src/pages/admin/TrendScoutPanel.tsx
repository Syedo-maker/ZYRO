import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { STORE_CURRENCIES } from '../../lib/currencies'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { trendsApi, type TrendImport, type TrendReport } from '../../lib/trendsApi'

const STATUS: Record<TrendReport['status'], { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  published: { label: 'Published', tone: 'success' },
  suppressed: { label: 'Withheld', tone: 'warning' },
  no_data: { label: 'No data', tone: 'neutral' },
}

const fieldClass = 'h-11 rounded-[10px] border border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

/**
 * The Trend Scout on the platform page (Part D): import a Google Trends file, run the week's reports
 * now, and see every market's reports for the latest week. Google Trends has no self-serve API, so
 * files are downloaded from trends.google.com ("Interest over time", download as CSV) and imported here.
 */
export function TrendScoutPanel() {
  const [reports, setReports] = useState<{ weekStart: string | null; reports: (TrendReport & { storeCount: number })[] } | null>(null)
  const [imports, setImports] = useState<TrendImport[]>([])
  const [market, setMarket] = useState('PKR')
  const [category, setCategory] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([trendsApi.platformReports(), trendsApi.imports()])
    setReports(r)
    setImports(i)
  }, [])

  useEffect(() => {
    load().catch((e) => setNote({ tone: 'error', text: errorMessage(e, 'Could not load the Trend Scout.') }))
  }, [load])

  async function importFile(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy('import')
    setNote(null)
    try {
      const done = await trendsApi.importGoogleTrends({ csv: await file.text(), market, category, fileName: file.name })
      setNote({ tone: 'success', text: `Imported ${done.terms.length} search ${done.terms.length === 1 ? 'term' : 'terms'} (${done.terms.join(', ')}) for ${done.market} / ${done.category}, up to ${done.periodEnd}. It is used from the next run.` })
      setFile(null)
      setCategory('')
      ;(e.target as HTMLFormElement).reset()
      await load()
    } catch (err) {
      setNote({ tone: 'error', text: errorMessage(err, 'Could not import the file.') })
    } finally {
      setBusy(null)
    }
  }

  async function runNow() {
    setBusy('run')
    setNote(null)
    try {
      const o = await trendsApi.runNow()
      setNote({ tone: 'success', text: `Week of ${o.weekStart}: ${o.published} published, ${o.suppressed} withheld, ${o.noData} with no data, ${o.existing} already done${o.failed ? `, ${o.failed} failed` : ''}.` })
      await load()
    } catch (err) {
      setNote({ tone: 'error', text: errorMessage(err, 'Could not run the reports.') })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Trend Scout" className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold">Trend Scout</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Weekly market reports per currency and category, shared by the stores in them. Store figures are published only when at least 5 stores sold
            in a category and none of them made up most of it. Runs every Monday; the AI cost is the platform's.
          </p>
        </div>
        <Button variant="secondary" className="h-10" disabled={busy !== null} onClick={() => void runNow()}>
          {busy === 'run' ? 'Running...' : 'Run this week now'}
        </Button>
      </div>

      {note && <Alert tone={note.tone}>{note.text}</Alert>}

      <form onSubmit={importFile} aria-label="Import a Google Trends file" className="flex flex-col gap-3 rounded-xl bg-bg p-4">
        <h3 className="text-sm font-bold">Import a Google Trends file</h3>
        <p className="text-xs text-text-secondary">
          On trends.google.com, compare up to 5 search terms for one country, then use the download button on "Interest over time". Pick the market and
          the category the terms belong to.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trend-market" className="text-xs font-semibold text-text-secondary">
              Market
            </label>
            <select id="trend-market" value={market} onChange={(e) => setMarket(e.target.value)} className={fieldClass}>
              {STORE_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}: {c.name}
                </option>
              ))}
            </select>
          </div>
          <Input id="trend-category" label="Category" required maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Home and kitchen" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trend-file" className="text-xs font-semibold text-text-secondary">
              CSV file
            </label>
            <input id="trend-file" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
        </div>
        <div>
          <Button type="submit" className="h-10" disabled={busy !== null || !file || !category.trim()}>
            {busy === 'import' ? 'Importing...' : 'Import'}
          </Button>
        </div>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-bold">{reports?.weekStart ? `Reports for the week starting ${reports.weekStart}` : 'Reports'}</h3>
        {!reports || reports.reports.length === 0 ? (
          <p className="text-sm text-text-secondary">No reports yet. They are written every Monday, or now with "Run this week now".</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-semibold">Market</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Category</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Status</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Stores</th>
                  <th scope="col" className="py-2 font-semibold">Written by</th>
                </tr>
              </thead>
              <tbody>
                {reports.reports.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2.5 pr-4">{r.market}</td>
                    <td className="py-2.5 pr-4">{r.name}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{r.storeCount}</td>
                    <td className="py-2.5 text-text-secondary">{r.source === 'ai' ? 'AI, checked' : r.source === 'template' ? 'From the facts' : 'Not written'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {imports.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-bold">Imported files</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {imports.map((i) => (
              <li key={i.id} className="text-text-secondary">
                <span className="font-semibold text-text">{i.market} / {i.category}</span>: {i.terms.join(', ')} ({i.geo}, to {i.periodEnd}), imported {formatDate(i.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
