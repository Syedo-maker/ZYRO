import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../../../lib/apiClient'
import { logoColours } from '../../../lib/logoColors'
import { uploadsApi } from '../../../lib/productsApi'
import type { SectionId, StoreTheme } from '../../../lib/storeTheme'
import type { ThemeFont, ThemePreset } from '../../../lib/themeApi'
import { ThemeSwatch } from './ThemeSwatch'

const SECTION_LABELS: Record<SectionId, string> = {
  hero: 'Hero (headline and banner)',
  featured: 'New arrivals',
  categories: 'Shop by category',
  reviews: 'What customers say',
  about: 'About the shop',
}
const COLOUR_LABELS: Record<keyof StoreTheme['colors'], string> = { primary: 'Main colour', accent: 'Accent', background: 'Background', text: 'Text' }
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
      <legend className="pr-2 text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</legend>
      {children}
    </fieldset>
  )
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={`min-h-9 rounded-control border px-3 text-xs font-semibold transition-colors ${value === o.id ? 'border-brand-ink bg-brand-soft text-brand-ink' : 'border-border text-text-secondary hover:border-text/40 hover:text-text'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TextField({ label, value, max, multiline, onChange }: { label: string; value: string | null; max: number; multiline?: boolean; onChange: (v: string | null) => void }) {
  const id = useId()
  const text = value ?? ''
  const common = {
    id,
    value: text,
    maxLength: max,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value.replace(/[<>{}]/g, '') || null),
    className: 'w-full rounded-control border border-border-input bg-bg px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-ring',
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-semibold text-text-secondary">
        <label htmlFor={id}>{label}</label>
        <span aria-hidden="true">
          {text.length}/{max}
        </span>
      </span>
      {multiline ? <textarea {...common} rows={4} /> : <input {...common} type="text" />}
    </div>
  )
}

/**
 * The Studio's manual controls (Store Themes, Part 2): everything the assistant can change, by hand,
 * in the same panel. They keep working when the AI is unavailable. Every value is one of the schema's
 * own choices, so nothing typed here can be refused by the server except a colour that is not hex.
 */
export function ThemeControls({
  storeId,
  theme,
  presets,
  fonts,
  onChange,
  onLogoColours,
  onError,
}: {
  storeId: string
  theme: StoreTheme
  presets: ThemePreset[]
  fonts: ThemeFont[]
  onChange: (theme: StoreTheme, delay?: number) => void
  onLogoColours: (colours: string[]) => void
  onError: (message: string) => void
}) {
  const [uploading, setUploading] = useState<'logo' | 'banner' | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<StoreTheme>, delay?: number) => onChange({ ...theme, ...patch }, delay)

  const applyPreset = (p: ThemePreset) =>
    // A preset changes the look; the owner's logo, banner, words and sections stay.
    set({ ...p.theme, logoUrl: theme.logoUrl, bannerUrl: theme.bannerUrl, heroHeadline: theme.heroHeadline, heroText: theme.heroText, aboutText: theme.aboutText, sections: theme.sections }, 0)

  const moveSection = (index: number, by: -1 | 1) => {
    const list = [...theme.sections]
    const [item] = list.splice(index, 1)
    list.splice(index + by, 0, item)
    set({ sections: list }, 0)
  }

  async function upload(kind: 'logo' | 'banner', file: File | undefined) {
    if (!file) return
    // The server checks the bytes too (JPEG, PNG or WebP only, never SVG); this just saves a trip.
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return onError('Use a JPEG, PNG or WebP image (SVG is not accepted).')
    if (file.size > MAX_IMAGE_BYTES) return onError('That image is over 5 MB. Please use a smaller one.')
    setUploading(kind)
    try {
      if (kind === 'logo') void logoColours(file).then(onLogoColours)
      const url = await uploadsApi.uploadImage(storeId, file)
      set(kind === 'logo' ? { logoUrl: url } : { bannerUrl: url }, 0)
    } catch (e) {
      onError(e instanceof ApiError ? e.detail ?? e.message : 'The image could not be uploaded.')
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Group title="Start from a look">
        <ul className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => applyPreset(p)}
                aria-pressed={theme.preset === p.id}
                className={`flex w-full flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors ${theme.preset === p.id ? 'border-brand-ink bg-brand-soft' : 'border-border hover:border-text/40'}`}
              >
                <ThemeSwatch tokens={p.tokens} className="h-12" />
                <span className="text-xs font-semibold text-text">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Colours">
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(COLOUR_LABELS) as (keyof StoreTheme['colors'])[]).map((key) => (
            <label key={key} className="flex flex-col gap-1.5 text-xs font-semibold text-text-secondary">
              {COLOUR_LABELS[key]}
              <span className="flex items-center gap-2 rounded-control border border-border-input bg-bg px-2 py-1.5">
                <input
                  type="color"
                  value={theme.colors[key]}
                  onChange={(e) => set({ colors: { ...theme.colors, [key]: e.target.value.toLowerCase() }, preset: null }, 350)}
                  aria-label={`${COLOUR_LABELS[key]} colour`}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="font-mono text-xs text-text">{theme.colors[key]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-text-muted">Colours that would be hard to read are adjusted automatically, and you will be told what changed.</p>
      </Group>

      <Group title="Fonts and shapes">
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-text-secondary">
          Font pair
          <select
            value={theme.font}
            onChange={(e) => set({ font: e.target.value as StoreTheme['font'] }, 0)}
            className="min-h-10 rounded-control border border-border-input bg-bg px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-ring"
          >
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <Choice label="Corners" value={theme.radius} onChange={(radius) => set({ radius }, 0)} options={[{ id: 'none', label: 'Sharp' }, { id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }]} />
        <Choice label="Buttons" value={theme.buttonStyle} onChange={(buttonStyle) => set({ buttonStyle }, 0)} options={[{ id: 'pill', label: 'Pill' }, { id: 'rounded', label: 'Rounded' }, { id: 'square', label: 'Square' }]} />
        <Choice label="Cards" value={theme.cardStyle} onChange={(cardStyle) => set({ cardStyle }, 0)} options={[{ id: 'flat', label: 'Flat' }, { id: 'bordered', label: 'Bordered' }, { id: 'shadow', label: 'Shadow' }]} />
        <Choice label="Surfaces" value={theme.surfaceStyle} onChange={(surfaceStyle) => set({ surfaceStyle }, 0)} options={[{ id: 'flat', label: 'Flat' }, { id: 'raised', label: 'Raised' }, { id: 'contrast', label: 'Contrast' }]} />
      </Group>

      <Group title="Logo and banner">
        {(['logo', 'banner'] as const).map((kind) => {
          const url = kind === 'logo' ? theme.logoUrl : theme.bannerUrl
          const input = kind === 'logo' ? logoInput : bannerInput
          return (
            <div key={kind} className="flex items-center gap-3">
              {url ? <img src={url} alt="" className={`${kind === 'logo' ? 'h-12 w-12' : 'h-12 w-20'} rounded-md border border-border object-cover`} /> : <span className={`${kind === 'logo' ? 'h-12 w-12' : 'h-12 w-20'} rounded-md border border-dashed border-border`} />}
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void upload(kind, e.target.files?.[0])} />
              <button type="button" onClick={() => input.current?.click()} disabled={uploading !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border px-3 text-xs font-semibold text-text hover:border-text/40 disabled:opacity-50">
                <ImagePlus aria-hidden="true" className="h-4 w-4" />
                {uploading === kind ? 'Uploading...' : url ? `Change ${kind}` : `Upload ${kind}`}
              </button>
              {url && (
                <button type="button" onClick={() => set(kind === 'logo' ? { logoUrl: null } : { bannerUrl: null }, 0)} aria-label={`Remove ${kind}`} className="grid h-9 w-9 place-items-center rounded-control text-text-secondary hover:bg-subtle hover:text-danger">
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
          )
        })}
        <p className="text-xs text-text-muted">JPEG, PNG or WebP, up to 5 MB.</p>
      </Group>

      <Group title="Homepage sections">
        <ol className="flex flex-col gap-1.5">
          {theme.sections.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-control border border-border px-2 py-1.5">
              <label className="flex flex-1 items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={s.visible} onChange={(e) => set({ sections: theme.sections.map((x) => (x.id === s.id ? { ...x, visible: e.target.checked } : x)) }, 0)} className="h-4 w-4 accent-[var(--color-brand)]" />
                {SECTION_LABELS[s.id]}
              </label>
              <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label={`Move ${SECTION_LABELS[s.id]} up`} className="grid h-8 w-8 place-items-center rounded-control text-text-secondary hover:bg-subtle disabled:opacity-30">
                <ArrowUp aria-hidden="true" className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => moveSection(i, 1)} disabled={i === theme.sections.length - 1} aria-label={`Move ${SECTION_LABELS[s.id]} down`} className="grid h-8 w-8 place-items-center rounded-control text-text-secondary hover:bg-subtle disabled:opacity-30">
                <ArrowDown aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <Choice label="Footer" value={theme.footerStyle} onChange={(footerStyle) => set({ footerStyle }, 0)} options={[{ id: 'simple', label: 'Simple' }, { id: 'detailed', label: 'Detailed' }, { id: 'minimal', label: 'Minimal' }]} />
      </Group>

      <Group title="Words">
        <TextField label="Hero headline" value={theme.heroHeadline} max={80} onChange={(heroHeadline) => set({ heroHeadline }, 700)} />
        <TextField label="Hero text" value={theme.heroText} max={200} multiline onChange={(heroText) => set({ heroText }, 700)} />
        <TextField label="About the shop" value={theme.aboutText} max={600} multiline onChange={(aboutText) => set({ aboutText }, 700)} />
      </Group>
    </div>
  )
}
