import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { catalogApi } from '../../lib/shopApi'
import type { Suggestion } from '../../types/shop'

/**
 * The header search: type-ahead suggestions from the store's own catalog (product titles that
 * have a word starting with what was typed), and Enter searches the whole catalog. It is a
 * standard combobox: arrow keys move through suggestions, Enter opens one, Escape closes.
 */
export function SearchBox({ storeId }: { storeId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const listId = useId()
  const [text, setText] = useState(() => new URLSearchParams(location.search).get('q') ?? '')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const box = useRef<HTMLDivElement>(null)

  // Suggestions follow the typing, a moment after the last key, and answers for older text are dropped.
  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      catalogApi
        .suggest(storeId, q)
        .then((s) => {
          if (cancelled) return
          setSuggestions(s)
          setActive(-1)
        })
        .catch(() => !cancelled && setSuggestions([]))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [storeId, text])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function search(e?: FormEvent) {
    e?.preventDefault()
    const q = text.trim()
    setOpen(false)
    navigate(q ? `/store/${storeId}/products?q=${encodeURIComponent(q)}` : `/store/${storeId}/products`)
  }

  function choose(s: Suggestion) {
    setOpen(false)
    setText(s.title)
    navigate(`/store/${storeId}/products/${s.id}`)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') return setOpen(false)
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      choose(suggestions[active])
    }
  }

  const showList = open && suggestions.length > 0
  return (
    <div ref={box} className="relative w-full">
      <form role="search" onSubmit={search} className="flex">
        <label htmlFor="store-search" className="sr-only">
          Search products
        </label>
        <input
          id="store-search"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={text}
          placeholder="Search products"
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded-l-[10px] border border-r-0 border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button type="submit" className="h-11 rounded-r-[10px] bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">
          Search
        </button>
      </form>
      {showList && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-[10px] border border-border bg-white">
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(s)
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm ${i === active ? 'bg-brand-soft' : ''}`}
            >
              <span className="font-medium">{s.title}</span>
              <span className="text-xs text-text-secondary">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
