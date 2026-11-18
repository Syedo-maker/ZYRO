import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

/**
 * The field every form uses. The shared look of fields (`fieldStyles`) is exported too, for the
 * selects and text areas written inline in pages.
 */
export const FIELD =
  'rounded-control border bg-surface px-3.5 text-sm text-text placeholder:text-text-muted outline-none ' +
  'transition-[border-color,box-shadow] duration-150 ease-standard focus:border-brand-ink focus:ring-4 focus:ring-brand-ink/15'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = '', ...props },
  ref
) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-text-secondary">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        // A read-only field (a value worked out for the user) sits on the page colour, so it does not look typeable.
        className={`h-11 ${FIELD} ${props.readOnly ? 'bg-bg' : ''} ${error ? 'border-danger' : 'border-border-input'} ${className}`}
        {...props}
      />
      {error && <span className="text-xs font-medium text-danger">{error}</span>}
    </div>
  )
})
