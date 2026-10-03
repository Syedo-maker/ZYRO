import { Link } from 'react-router-dom'
import type { SearchInterpretation } from '../../types/shop'

/**
 * Tells the shopper when their search was not taken literally (Part F): a spelling fixed, a word
 * understood as another, or results found by meaning when the words themselves matched nothing.
 *
 * It always offers a way back to exactly what was typed. A search engine that silently changes the
 * question is worse than one that finds nothing, because the shopper cannot tell it has happened.
 */
export function SearchNote({ interpretation, query, storeId }: { interpretation?: SearchInterpretation; query: string; storeId: string }) {
  if (!interpretation || !query) return null

  const exactHref = `/store/${storeId}/products?q=${encodeURIComponent(query)}&exact=1`

  if (interpretation.step === 'corrected' && interpretation.correctedTo) {
    return (
      <p role="status" className="text-sm text-text-secondary">
        Showing results for <span className="font-semibold text-text">{interpretation.correctedTo}</span>.{' '}
        <Link to={exactHref} className="font-semibold text-brand hover:text-brand-hover">
          Search for "{query}" instead
        </Link>
      </p>
    )
  }

  if (interpretation.step === 'synonym' && interpretation.alsoSearched.length > 0) {
    return (
      <p role="status" className="text-sm text-text-secondary">
        Also showing products for <span className="font-semibold text-text">{interpretation.alsoSearched.join(', ')}</span>.
      </p>
    )
  }

  if (interpretation.step === 'semantic') {
    return (
      <p role="status" className="text-sm text-text-secondary">
        Nothing matched those exact words, so these are products that seem close to what you asked for.
      </p>
    )
  }

  return null
}
