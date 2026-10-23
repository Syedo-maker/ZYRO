import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

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
        className={`h-11 rounded-[10px] border px-3.5 text-sm ${props.readOnly ? 'bg-bg' : 'bg-surface'} outline-none focus:ring-2 focus:ring-brand/30 ${
          error ? 'border-danger' : 'border-border-input focus:border-brand'
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
})
