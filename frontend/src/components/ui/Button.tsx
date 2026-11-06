import type { ButtonHTMLAttributes } from 'react'

/**
 * Zyro's buttons: one set of variants for every surface, from the landing page to the register.
 *
 * `buttonStyles` is exported on its own because many of the most important "buttons" are links
 * (Start free, Go to checkout) and must stay links for the router and for screen readers; they take
 * the same classes instead of a look-alike copy. Every colour is a semantic token, so on a storefront
 * `primary` wears the merchant's colour and on the platform it wears Zyro's lime.
 *
 * The look, the same everywhere: a pill, a bold label, a slight lift and a soft glow on hover, a
 * darker fill while pressed, and the lime focus ring.
 */

export type ButtonVariant =
  | 'primary' // the main action of a screen: lime (or the shop's colour), black text
  | 'accent' // the platform's call to action (Start free): always Zyro's lime
  | 'secondary' // the alternative: transparent, a thin light border
  | 'danger' // destroys or refunds something
  | 'ghost' // a quiet action inside a toolbar or list
  | 'inverse' // the main action on the chrome (the sidebar, the register bar): same as primary
  | 'outline-inverse' // the alternative on the chrome
  | 'outline' // the alternative on a highlighted band

export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full select-none ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-standard ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-45'

// Filled buttons lift by a pixel and glow on hover, and sink back while pressed.
const LIFT = 'hover:-translate-y-px active:translate-y-0'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `bg-brand text-on-brand hover:bg-brand-hover hover:shadow-glow active:bg-brand ${LIFT} focus-visible:outline-ring`,
  accent: `bg-accent text-on-accent hover:bg-accent-hover hover:shadow-glow active:bg-accent-pressed ${LIFT} focus-visible:outline-ring`,
  secondary: 'border border-text/25 bg-transparent text-text hover:border-text/60 hover:bg-text/5 focus-visible:outline-ring',
  danger: 'border border-danger/60 bg-transparent text-danger hover:border-danger hover:bg-danger-soft focus-visible:outline-ring',
  ghost: 'text-text-secondary hover:bg-subtle hover:text-text focus-visible:outline-ring',
  inverse: `bg-accent text-on-accent hover:bg-accent-hover hover:shadow-glow active:bg-accent-pressed ${LIFT} focus-visible:outline-ring`,
  'outline-inverse': 'border border-on-inverse/25 text-on-inverse hover:border-on-inverse/60 hover:bg-on-inverse/5 focus-visible:outline-ring',
  outline: 'border border-accent/60 text-text hover:border-accent hover:bg-accent/10 focus-visible:outline-ring',
}

// Every size clears the 24px minimum target (WCAG 2.5.8); md is the default because 44px is
// comfortable for a thumb on the phone most merchants run their shop from.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-7 text-base',
}

// A caller's own height, padding, text size, radius or focus colour replaces the default, rather
// than competing with it: two utilities for the same property both land in the stylesheet, and which
// wins depends on Tailwind's ordering, not the order of the classes.
const OVERRIDES: [RegExp, RegExp][] = [
  [/^h-/, /(^|\s)h-\S+/],
  [/^px-/, /(^|\s)px-\S+/],
  [/^text-(xs|sm|base|lg|xl|\[)/, /(^|\s)text-(xs|sm|base|lg|xl|\[)\S*/],
  [/^font-bold$/, /(^|\s)font-(normal|medium|semibold|extrabold)(\s|$)/],
  [/^rounded-full$/, /(^|\s)rounded(-\S+)?(\s|$)/],
  [/^focus-visible:outline-(ring|on-inverse)$/, /(^|\s)focus-visible:outline-(ring|on-inverse)(\s|$)/],
]

export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  let defaults = `font-bold ${VARIANTS[variant]} ${SIZES[size]}`
  let base = BASE
  for (const [own, given] of OVERRIDES) {
    if (!given.test(className)) continue
    defaults = defaults.split(' ').filter((c) => !own.test(c)).join(' ')
    base = base.split(' ').filter((c) => !own.test(c)).join(' ')
  }
  return `${base} ${defaults} ${className}`.trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and keeps the button from being pressed again while its action runs. */
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', className = '', loading = false, disabled, children, ...props }: ButtonProps) {
  return (
    <button className={buttonStyles({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}
