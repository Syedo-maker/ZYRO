import { useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button, buttonStyles, type ButtonVariant } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FIELD, Input } from '../../components/ui/Input'
import { Skeleton, Spinner } from '../../components/ui/Spinner'
import { Wordmark } from '../../components/ui/Wordmark'

/**
 * The living style guide: every token and every shared component, in every state, on one page.
 * Development only (the route exists only under `npm run dev`), so it never ships to shoppers.
 * Everything here is drawn from src/index.css and components/ui; nothing has a colour of its own.
 */

const SURFACES = [
  ['bg', 'bg-bg'],
  ['surface', 'bg-surface'],
  ['subtle', 'bg-subtle'],
  ['surface-2', 'bg-surface-2'],
  ['inverse', 'bg-inverse'],
  ['border', 'bg-border'],
  ['border-input', 'bg-border-input'],
] as const
const TEXT = [
  ['text', 'text-text'],
  ['text-secondary', 'text-text-secondary'],
  ['text-muted', 'text-text-muted'],
  ['accent (lime)', 'text-accent'],
] as const
const ACCENTS = [
  ['accent', 'bg-accent'],
  ['accent-hover', 'bg-accent-hover'],
  ['accent-pressed', 'bg-accent-pressed'],
  ['brand-soft', 'bg-brand-soft'],
  ['landing-cobalt (landing only)', 'bg-landing-cobalt'],
] as const
const STATUS = [
  ['success', 'bg-success', 'bg-success-soft'],
  ['warning', 'bg-warning', 'bg-warning-soft'],
  ['danger', 'bg-danger', 'bg-danger-soft'],
] as const
const VARIANTS: ButtonVariant[] = ['primary', 'accent', 'secondary', 'ghost', 'danger', 'outline']
const RADII = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-control', 'rounded-xl', 'rounded-2xl', 'rounded-3xl', 'rounded-full']
const SHADOWS = ['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-glow', 'shadow-glow-lg']
const TYPE = [
  ['display', 'font-serif text-display italic'],
  ['h1', 'font-serif text-h1'],
  ['h2', 'font-display text-h2 font-bold'],
  ['h3', 'font-display text-h3 font-bold'],
  ['h4', 'font-display text-h4 font-bold'],
  ['body', 'text-body'],
  ['small', 'text-small text-text-secondary'],
  ['caption', 'text-caption text-text-muted'],
] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-10">
      <h2 className="font-display text-h3 font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-16 rounded-xl border border-border ${className}`} />
      <code className="text-xs text-text-secondary">{name}</code>
    </div>
  )
}

export function StyleGuidePage() {
  const [dialog, setDialog] = useState(false)
  const [on, setOn] = useState(true)
  const [tab, setTab] = useState('Overview')

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3">
        <Wordmark className="text-2xl" />
        <h1 className="font-serif text-h1">
          Style <em className="italic text-accent">guide</em>
        </h1>
        <p className="max-w-2xl text-text-secondary">
          Every token in src/index.css and every shared component, in each state. Black and lime everywhere; cobalt on the landing page only.
          Development only.
        </p>
      </header>

      <Section title="Colour">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {SURFACES.map(([n, c]) => (
            <Swatch key={n} name={n} className={c} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {ACCENTS.map(([n, c]) => (
            <Swatch key={n} name={n} className={c} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {STATUS.map(([n, strong, soft]) => (
            <div key={n} className="flex flex-col gap-2">
              <div className="flex h-16 overflow-hidden rounded-xl border border-border">
                <div className={`flex-1 ${strong}`} />
                <div className={`flex-1 ${soft}`} />
              </div>
              <code className="text-xs text-text-secondary">{n} / {n}-soft</code>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          {TEXT.map(([n, c]) => (
            <span key={n} className={`text-sm font-semibold ${c}`}>
              {n}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-4">
          {TYPE.map(([n, c]) => (
            <div key={n} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
              <code className="w-20 shrink-0 text-xs text-text-muted">{n}</code>
              <span className={c}>Apni dukaan online lao</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius and shadow">
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div className={`h-16 w-16 border border-border bg-surface ${r}`} />
              <code className="text-xs text-text-secondary">{r.replace('rounded-', '')}</code>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          {SHADOWS.map((s) => (
            <div key={s} className={`grid h-20 w-32 place-items-center rounded-2xl bg-surface text-xs text-text-secondary ${s}`}>
              {s.replace('shadow-', '')}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        {VARIANTS.map((v) => (
          <div key={v} className="flex flex-wrap items-center gap-3">
            <code className="w-24 text-xs text-text-muted">{v}</code>
            <Button variant={v} size="sm">
              Small
            </Button>
            <Button variant={v}>Default</Button>
            <Button variant={v} size="lg">
              Large
            </Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
            <Button variant={v} loading>
              Saving
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <code className="w-24 text-xs text-text-muted">call to action</code>
          <a href="#buttons" className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group hover:shadow-glow-lg' })}>
            Start your store free
            <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.25} />
          </a>
          <button type="button" aria-label="Ask the AI" className="grid h-11 w-11 place-items-center rounded-full border border-border text-accent hover:border-accent/50">
            <Sparkles aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input id="sg-name" label="Store name" placeholder="Noor Handicrafts" />
          <Input id="sg-error" label="Store URL" defaultValue="Noor!" error="Use lowercase letters, digits or hyphens." />
          <Input id="sg-read" label="Selling price (worked out)" readOnly value="Rs 7,500" />
          <Input id="sg-off" label="Disabled" disabled value="Not editable" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sg-select" className="text-xs font-semibold text-text-secondary">
              Category
            </label>
            <select id="sg-select" className={`h-11 border-border-input ${FIELD}`}>
              <option>Home decor</option>
              <option>Kitchen</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sg-text" className="text-xs font-semibold text-text-secondary">
              Description
            </label>
            <textarea id="sg-text" rows={3} className={`border-border-input py-2.5 ${FIELD}`} defaultValue="Hand-polished brass." />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked className="h-4 w-4" /> Checkbox
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="sg-radio" defaultChecked className="h-4 w-4" /> Radio
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => setOn((v) => !v)}
            className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${on ? 'bg-accent' : 'bg-border-input'}`}
          >
            <span className={`absolute left-0 top-1 h-5 w-5 rounded-full transition-transform duration-200 ${on ? 'translate-x-6 bg-bg' : 'translate-x-1 bg-text'}`} />
            <span className="sr-only">Switch</span>
          </button>
        </div>
      </Section>

      <Section title="Tabs, badges and progress">
        <div role="tablist" aria-label="Example" className="inline-flex w-fit gap-1 rounded-full border border-border bg-surface p-1">
          {['Overview', 'Orders', 'Reviews'].map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`h-9 rounded-full px-4 text-sm font-semibold transition-colors ${tab === t ? 'bg-accent text-on-accent' : 'text-text-secondary hover:text-text'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">Paid</Badge>
          <Badge tone="warning">Pending</Badge>
          <Badge tone="danger">Refunded</Badge>
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="ai">AI draft</Badge>
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-on-accent">20% off</span>
        </div>
        <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-subtle">
          <div className="h-full w-3/5 rounded-full bg-accent" />
        </div>
      </Section>

      <Section title="Alerts, loading and empty states">
        <div className="grid gap-3 sm:grid-cols-3">
          <Alert tone="info">Saved as a draft.</Alert>
          <Alert tone="success">Order marked paid.</Alert>
          <Alert tone="error">The payment could not be taken.</Alert>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Spinner />
          <div className="flex w-64 flex-col gap-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent">
            <Sparkles aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <p className="font-semibold">No orders yet</p>
          <p className="max-w-sm text-sm text-text-secondary">Share your shop link and the first order will appear here.</p>
        </div>
      </Section>

      <Section title="Cards, tables and dialogs">
        <div className="grid gap-4 sm:grid-cols-3">
          {['Net sales', 'Orders', 'Average order'].map((l, i) => (
            <div key={l} className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-5">
              <p className="text-xs font-semibold text-text-secondary">{l}</p>
              <p className="font-display text-3xl font-bold tabular-nums text-brand">{['Rs 524,692', '82', 'Rs 6,398'][i]}</p>
              <p className="text-xs font-medium text-success">↑ 12.4% vs previous period</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ['#112', 'Sara', 'success', 'Paid', 'Rs 3,714'],
                ['#111', 'Bushra', 'warning', 'Pending', 'Rs 2,650'],
              ].map(([o, c, t, s, total]) => (
                <tr key={o} className="hover:bg-subtle">
                  <td className="px-4 py-3 font-semibold">{o}</td>
                  <td className="px-4 py-3 text-text-secondary">{c}</td>
                  <td className="px-4 py-3">
                    <Badge tone={t as 'success' | 'warning'}>{s}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open a dialog
          </Button>
          <Dialog open={dialog} title="Close the shift" onClose={() => setDialog(false)}>
            <p className="text-sm text-text-secondary">Count the cash in the drawer and type the total.</p>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={() => setDialog(false)}>
                Close shift
              </Button>
            </div>
          </Dialog>
        </div>
      </Section>

      <Section title="Chat">
        <div className="flex max-w-sm flex-col gap-3 rounded-3xl border border-border bg-surface p-4">
          <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-sm font-medium text-on-brand">Do you have clay chai cups?</p>
          <p className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-subtle px-3.5 py-2.5 text-sm">
            Yes: the Clay Chai Cup set of 4 is Rs 1,620, 10% off.
          </p>
        </div>
      </Section>
    </div>
  )
}
