import { ChevronUp, History, Redo2, Sparkles, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Spinner } from '../../../components/ui/Spinner'
import { useToast } from '../../../components/ui/useToast'
import { useAuth } from '../../../context/AuthContext'
import { aiUsageApi } from '../../../lib/aiContentApi'
import { ApiError } from '../../../lib/apiClient'
import { logoColours as readLogoColours } from '../../../lib/logoColors'
import { catalogApi } from '../../../lib/shopApi'
import { themeApi, type DesignOption, type PolishResult, type QuickAction, type ThemeFont, type ThemePreset } from '../../../lib/themeApi'
import type { StoreTheme } from '../../../lib/storeTheme'
import type { AiUsageQuota } from '../../../types/shop'
import { AssistantPanel } from './AssistantPanel'
import { StudioPreview } from './StudioPreview'
import { ThemeControls } from './ThemeControls'
import { useThemeDraft } from './useThemeDraft'

type Tab = 'assistant' | 'customize'

/**
 * The Theme Studio (Store Themes, Part 2), owner only. A large live preview of the real storefront on
 * the left; on the right (a bottom sheet on a phone) the design assistant and the manual controls.
 * Every change is a draft: Undo and Redo walk it, versions can be restored, Finish and polish tidies
 * it, and nothing reaches shoppers until Publish. The Studio itself wears Zyro's own look.
 */
export function ThemeStudioPage() {
  const { activeStore } = useAuth()
  if (!activeStore) return null
  if (activeStore.role !== 'owner') return <Alert tone="info">Only the store owner can change the store's theme.</Alert>
  return <Studio storeId={activeStore.id} />
}

function Studio({ storeId }: { storeId: string }) {
  const toast = useToast()
  const { state, theme, saving, notice, loadError, change, run, flush, adopt } = useThemeDraft(storeId, toast.error)
  const [tab, setTab] = useState<Tab>('assistant')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [presets, setPresets] = useState<ThemePreset[]>([])
  const [fonts, setFonts] = useState<ThemeFont[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  const [quota, setQuota] = useState<AiUsageQuota | null>(null)
  const [logoColours, setLogoColours] = useState<string[]>([])
  const [versions, setVersions] = useState<{ id: string; publishedAt: string }[] | null>(null)
  const [polish, setPolish] = useState<PolishResult | null>(null)

  const refreshQuota = useCallback(() => {
    aiUsageApi.get(storeId).then(setQuota).catch(() => setQuota(null))
  }, [storeId])

  useEffect(() => {
    themeApi.options(storeId).then((o) => {
      setPresets(o.presets)
      setFonts(o.fonts)
    }).catch(() => undefined)
    catalogApi.list(storeId, { sort: 'newest', limit: 1 }).then((r) => setProductId(r.data[0]?.id ?? null)).catch(() => undefined)
    refreshQuota()
  }, [storeId, refreshQuota])

  // An already uploaded logo: read its colours if the browser may (same site, or a host that allows it).
  const logoUrl = theme?.logoUrl ?? null
  useEffect(() => {
    if (!logoUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => void readLogoColours(img).then((c) => c.length && setLogoColours(c))
    img.src = logoUrl
  }, [logoUrl])

  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) for Undo and Redo, outside text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey && state?.canUndo) {
        e.preventDefault()
        void run(() => themeApi.undo(storeId))
      } else if ((key === 'y' || (key === 'z' && e.shiftKey)) && state?.canRedo) {
        e.preventDefault()
        void run(() => themeApi.redo(storeId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, state?.canUndo, state?.canRedo, storeId])

  // The assistant's own words come back in the conversation (unavailable, allowance used up, a design
  // it could not make), not as a toast, and the manual controls stay usable whatever happens.
  const ask = async (body: { message?: string; action?: QuickAction; logoColors?: string[] }) => {
    await flush()
    try {
      const answer = await themeApi.ask(storeId, body)
      adopt(answer.state)
      return { answer, error: null }
    } catch (e) {
      return { answer: null, error: e instanceof ApiError ? e.detail ?? e.message : null }
    } finally {
      refreshQuota()
    }
  }

  const tryOption = (option: DesignOption) => theme && change({ ...option.theme, logoUrl: theme.logoUrl, bannerUrl: theme.bannerUrl }, 0)

  const publish = async () => {
    const next = await run(() => themeApi.publish(storeId))
    if (next) toast.success('Your theme is live. Shoppers see it now.')
  }

  const openVersions = async () => {
    try {
      setVersions((await themeApi.versions(storeId)).versions)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail ?? e.message : 'Could not load the versions.')
    }
  }

  const restore = async (id: string) => {
    setVersions(null)
    const next = await run(() => themeApi.restore(storeId, id))
    if (next) toast.info('That version is now your draft. Publish to make it live again.')
  }

  const runPolish = async () => {
    const result = await run(() => themeApi.polish(storeId))
    if (result) setPolish(result as PolishResult)
  }

  if (loadError) return <Alert>{loadError}</Alert>
  if (!state || !theme) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Spinner label="Loading the Theme Studio" />
      </div>
    )
  }

  const status = saving ? 'Saving...' : state.hasUnpublishedChanges ? 'Draft: not published yet' : 'Published'
  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`studio-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`studio-panel-${id}`}
      onClick={() => setTab(id)}
      className={`min-h-10 flex-1 rounded-control text-sm font-semibold transition-colors ${tab === id ? 'bg-brand-soft text-brand-ink' : 'text-text-secondary hover:text-text'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="-m-4 flex min-h-[calc(100vh-68px)] flex-col gap-4 p-4 pb-28 lg:-m-8 lg:p-8 lg:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-xl font-bold">Theme</h1>
          <p role="status" className={`text-xs font-semibold ${state.hasUnpublishedChanges ? 'text-warning' : 'text-success'}`}>
            {status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void run(() => themeApi.undo(storeId))} disabled={!state.canUndo || saving} aria-label="Undo">
            <Undo2 aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Undo</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void run(() => themeApi.redo(storeId))} disabled={!state.canRedo || saving} aria-label="Redo">
            <Redo2 aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Redo</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openVersions()}>
            <History aria-hidden="true" className="h-4 w-4" />
            Versions
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void runPolish()} disabled={saving}>
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Finish and polish
          </Button>
          <Button size="sm" onClick={() => void publish()} disabled={saving || !state.hasUnpublishedChanges}>
            Publish
          </Button>
        </div>
      </div>

      {/* What the contrast guard changed on the last save, read out once. */}
      <div aria-live="polite">{notice && <Alert tone="info">{notice}</Alert>}</div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <StudioPreview storeId={storeId} productId={productId} theme={theme} tokens={state.tokens} />

        <aside
          aria-label="Design tools"
          className={`fixed inset-x-0 bottom-0 z-[var(--z-drawer)] flex flex-col gap-3 rounded-t-3xl border-t border-border bg-surface p-4 shadow-lg transition-[max-height] duration-200 ease-standard lg:static lg:z-auto lg:max-h-none lg:w-[400px] lg:shrink-0 lg:rounded-2xl lg:border lg:shadow-none ${
            sheetOpen ? 'max-h-[78vh]' : 'max-h-[64px]'
          }`}
        >
          <button
            type="button"
            onClick={() => setSheetOpen((o) => !o)}
            aria-expanded={sheetOpen}
            className="flex min-h-8 items-center justify-between text-sm font-bold text-text lg:hidden"
          >
            Design assistant and controls
            <ChevronUp aria-hidden="true" className={`h-5 w-5 transition-transform ${sheetOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className={`${sheetOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col gap-3 lg:flex`}>
            <div role="tablist" aria-label="Design tools" className="flex gap-1 rounded-control border border-border p-1">
              {tabButton('assistant', 'Assistant')}
              {tabButton('customize', 'Customize')}
            </div>
            <div id="studio-panel-assistant" role="tabpanel" aria-labelledby="studio-tab-assistant" hidden={tab !== 'assistant'} className="flex min-h-0 flex-1 flex-col overflow-hidden lg:max-h-[calc(100vh-260px)]">
              <AssistantPanel ask={ask} onTry={tryOption} quota={quota} logoColours={logoColours} hasLogo={!!theme.logoUrl} />
            </div>
            <div id="studio-panel-customize" role="tabpanel" aria-labelledby="studio-tab-customize" hidden={tab !== 'customize'} className="min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-260px)]">
              <ThemeControls storeId={storeId} theme={theme} presets={presets} fonts={fonts} onChange={(t: StoreTheme, delay?: number) => change(t, delay)} onLogoColours={setLogoColours} onError={toast.error} />
            </div>
          </div>
        </aside>
      </div>

      <Dialog open={versions !== null} title="Published versions" onClose={() => setVersions(null)}>
        {versions?.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing has been published yet. Each time you publish, that version is kept here (the last 10).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versions?.map((v, i) => (
              <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="text-sm text-text">
                  {new Date(v.publishedAt).toLocaleString()}
                  {i === 0 && <span className="ml-2 text-xs font-semibold text-success">Live now</span>}
                </span>
                <Button size="sm" variant="secondary" onClick={() => void restore(v.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>

      <Dialog open={polish !== null} title="Finish and polish" onClose={() => setPolish(null)} size="lg">
        {polish && (
          <div className="flex flex-col gap-4" aria-live="polite">
            <p className="text-sm font-semibold text-text">{polish.summary}</p>
            {polish.fixes.length > 0 && (
              <section aria-labelledby="polish-fixed">
                <h3 id="polish-fixed" className="mb-2 text-xs font-bold uppercase tracking-wide text-text-secondary">Fixed</h3>
                <ul className="flex flex-col gap-1.5">
                  {polish.fixes.map((f, i) => (
                    <li key={i} className="rounded-lg bg-success-soft px-3 py-2 text-sm text-text">
                      <span className="font-semibold capitalize">{f.area}:</span> {f.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {polish.notes.length > 0 && (
              <section aria-labelledby="polish-notes">
                <h3 id="polish-notes" className="mb-2 text-xs font-bold uppercase tracking-wide text-text-secondary">Worth a look</h3>
                <ul className="flex flex-col gap-1.5">
                  {polish.notes.map((n, i) => (
                    <li key={i} className="rounded-lg bg-subtle px-3 py-2 text-sm text-text">
                      <span className="font-semibold capitalize">{n.area}:</span> {n.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPolish(null)}>
                Keep editing
              </Button>
              <Button
                onClick={() => {
                  setPolish(null)
                  void publish()
                }}
              >
                Publish now
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
