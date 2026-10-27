import type { ButtonHTMLAttributes } from 'react'

/**
 * ZYRO's buttons: one set of variants for every surface, from the landing page to the register.
 *
 * `buttonStyles` is exported on its own because many of the most important "buttons" are links
 * (Start free, Go to checkout) and must stay links for the router and for screen readers; they take
 * the same classes instead of a look-alike copy. Every colour is a semantic token, so on a storefront
 * `primary` wears the merchant's colour and on the platform it wears ZYRO's.
 */

export type ButtonVariant =
  | 'primary' // the main action of a screen
  | 'accent' // the platform's call to action (Start free); terracotta, white text 6.42
  | 'secondary' // the alternative to the main action
  | 'danger' // destroys or refunds something
  | 'ghost' // a quiet action inside a toolbar or list
  | 'inverse' // the main action on the dark surface
  | 'outline-inverse' // the alternative on the dark surface; its border reaches 5.41 so it reads as a button
  | 'outline' // the alternative on a coloured band (the orange call-to-action), where a white fill would shout

export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-[10px] transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ' +
  'aria-disabled:pointer-events-none aria-disabled:opacity-50'

// The focus outline is the accent on light surfaces and the cream on the dark one: both measured
// in src/index.css, and both well above the 3:1 an indicator needs.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover focus-visible:outline-ring',
  accent: 'bg-accent text-on-accent hover:bg-accent-hover focus-visible:outline-ring',
  secondary: 'border border-border-input bg-surface text-text hover:bg-bg focus-visible:outline-ring',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-soft focus-visible:outline-ring',
  ghost: 'text-text-secondary hover:bg-subtle hover:text-text focus-visible:outline-ring',
  inverse: 'bg-on-inverse text-text hover:bg-surface focus-visible:outline-on-inverse',
  'outline-inverse':
    'border border-on-inverse-muted text-on-inverse hover:bg-on-inverse hover:text-text focus-visible:outline-on-inverse',
  outline: 'border-2 border-text text-text hover:bg-inverse hover:text-on-inverse focus-visible:outline-ring',
}

// Every size clears the 24px minimum target (WCAG 2.5.8); md is the default because 44px is
// comfortable for a thumb on the phone most merchants run their shop from.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
}

// A caller's own height, padding, text size or focus colour replaces the default, rather than
// competing with it.
// Two utilities for the same property both land in the stylesheet, and which wins depends on
// Tailwind's ordering, not the order of the classes: `h-10` used to lose to the default `h-11`.
const OVERRIDES: [RegExp, RegExp][] = [
  [/^h-/, /(^|\s)h-\S+/],
  [/^px-/, /(^|\s)px-\S+/],
  [/^text-(xs|sm|base|lg|xl|\[)/, /(^|\s)text-(xs|sm|base|lg|xl|\[)\S*/],
  [/^font-semibold$/, /(^|\s)font-(normal|medium|bold|extrabold)(\s|$)/],
  [/^focus-visible:outline-(ring|on-inverse)$/, /(^|\s)focus-visible:outline-(ring|on-inverse)(\s|$)/],
]

export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  let defaults = `font-semibold ${VARIANTS[variant]} ${SIZES[size]}`
  for (const [own, given] of OVERRIDES) {
    if (given.test(className)) defaults = defaults.split(' ').filter((c) => !own.test(c)).join(' ')
  }
  return `${BASE} ${defaults} ${className}`.trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={buttonStyles({ variant, size, className })} {...props} />
}
